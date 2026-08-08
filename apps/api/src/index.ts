import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Ticket } from "@repo/db";
import { env } from "@repo/env";
import ffmpegPath from "ffmpeg-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as loggerMiddleware } from "hono/logger";

const app = new Hono();
const MAX_MEDIA_BYTES = 25 * 1_024 * 1_024;
const MAX_ACTIVE_TRANSCODES = 2;
const MAX_MEDIA_AUTH_WINDOW_MS = 12 * 60 * 60 * 1_000;
const MAX_TRANSCRIPT_AUTH_WINDOW_MS = 15 * 60 * 1_000;
const FFMPEG_RUNTIME_LIMIT_MS = 30 * 60 * 1_000;
const FFMPEG_TERMINATION_GRACE_MS = 2_000;
const SHUTDOWN_GRACE_PERIOD_MS = 5_000;
const SHUTDOWN_DEADLINE_MS = 8_000;

function requireSigningSecret(): string {
	const secret = env.API_SIGNING_SECRET;
	if (!secret) {
		throw new Error("API_SIGNING_SECRET is required to start the API because signed media and transcript routes are enabled");
	}
	return secret;
}

const signingSecret = requireSigningSecret();

type TranscodeChild = ReturnType<typeof spawn>;
type TranscodeState = {
	child: TranscodeChild;
	deadlineTimer: NodeJS.Timeout | undefined;
	escalationTimer: NodeJS.Timeout | undefined;
	onAbort: () => void;
	onChildClose: () => void;
	onChildError: () => void;
	onStdoutClose: () => void;
	onStdoutError: () => void;
	released: boolean;
	releasedPromise: Promise<void>;
	requestSignal: AbortSignal;
	resolveReleased: () => void;
};

const activeTranscodes = new Set<TranscodeState>();
let shuttingDown = false;

function releaseTranscode(state: TranscodeState): void {
	if (state.released) return;
	state.released = true;
	if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
	if (state.escalationTimer) clearTimeout(state.escalationTimer);
	state.requestSignal.removeEventListener("abort", state.onAbort);
	state.child.removeListener("close", state.onChildClose);
	state.child.removeListener("error", state.onChildError);
	state.child.stdout?.removeListener("close", state.onStdoutClose);
	state.child.stdout?.removeListener("error", state.onStdoutError);
	activeTranscodes.delete(state);
	state.resolveReleased();
}

function forceTerminateTranscode(state: TranscodeState): void {
	if (state.released) return;
	if (state.child.exitCode !== null || state.child.signalCode !== null) {
		releaseTranscode(state);
		return;
	}
	try {
		state.child.kill("SIGKILL");
	} catch {
		// The close/error handlers own cleanup when process termination races with exit.
	}
	state.child.stdout?.destroy();
}

function terminateTranscode(state: TranscodeState): void {
	if (state.released) return;
	if (state.child.exitCode !== null || state.child.signalCode !== null) {
		releaseTranscode(state);
		return;
	}
	try {
		state.child.kill("SIGTERM");
	} catch {
		// Escalation below still destroys the stream and retries termination.
	}
	if (!state.escalationTimer) {
		state.escalationTimer = setTimeout(() => {
			state.escalationTimer = undefined;
			forceTerminateTranscode(state);
		}, FFMPEG_TERMINATION_GRACE_MS);
		state.escalationTimer.unref();
	}
}

function trackTranscode(child: TranscodeChild, requestSignal: AbortSignal): TranscodeState {
	let resolveReleased = () => {};
	const releasedPromise = new Promise<void>((resolve) => {
		resolveReleased = resolve;
	});
	const state: TranscodeState = {
		child,
		deadlineTimer: undefined,
		escalationTimer: undefined,
		onAbort: () => terminateTranscode(state),
		onChildClose: () => releaseTranscode(state),
		onChildError: () => {
			if (child.pid === undefined) releaseTranscode(state);
			else terminateTranscode(state);
		},
		onStdoutClose: () => terminateTranscode(state),
		onStdoutError: () => terminateTranscode(state),
		released: false,
		releasedPromise,
		requestSignal,
		resolveReleased,
	} satisfies TranscodeState;

	activeTranscodes.add(state);
	child.once("close", state.onChildClose);
	child.once("error", state.onChildError);
	child.stdout?.once("close", state.onStdoutClose);
	child.stdout?.once("error", state.onStdoutError);
	if (requestSignal.aborted) terminateTranscode(state);
	else requestSignal.addEventListener("abort", state.onAbort, { once: true });
	state.deadlineTimer = setTimeout(() => {
		console.error("Media transcoder exceeded its runtime deadline");
		terminateTranscode(state);
	}, FFMPEG_RUNTIME_LIMIT_MS);
	state.deadlineTimer.unref();
	return state;
}

function waitForSpawn(child: TranscodeChild): Promise<boolean> {
	return new Promise((resolve) => {
		const cleanup = () => {
			child.removeListener("spawn", onSpawn);
			child.removeListener("error", onError);
		};
		const onSpawn = () => {
			cleanup();
			resolve(true);
		};
		const onError = () => {
			cleanup();
			resolve(false);
		};
		child.once("spawn", onSpawn);
		child.once("error", onError);
	});
}

function validSignature(payload: string, signature: string) {
	if (!/^[a-f\d]{64}$/i.test(signature)) return false;
	const received = Buffer.from(signature, "hex");
	const expected = createHmac("sha256", signingSecret).update(payload).digest();
	return timingSafeEqual(received, expected);
}

function validExpiration(expiresText: string, maximumWindowMs: number) {
	if (!/^\d{13}$/.test(expiresText)) return false;
	const expires = Number(expiresText);
	const now = Date.now();
	return Number.isSafeInteger(expires) && expires >= now && expires <= now + maximumWindowMs;
}

function isDiscordAttachmentPath(pathname: string) {
	return pathname.startsWith("/attachments/") || pathname.startsWith("/ephemeral-attachments/");
}

function isDiscordAttachmentUrl(value: string) {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return url.protocol === "https:" && (hostname === "cdn.discordapp.com" || hostname === "media.discordapp.net") && isDiscordAttachmentPath(url.pathname);
	} catch {
		return false;
	}
}

const requestLogger = loggerMiddleware();
app.use(
	cors({
		origin: "*",
		allowMethods: ["GET"],
	}),
);
app.use("*", async (c, next) => {
	// Signed URLs contain credentials and are deliberately excluded from request logs.
	if (c.req.path === "/api/media/audio" || c.req.path.startsWith("/api/transcript/")) return next();
	return requestLogger(c, next);
});

app.onError((error, c) => {
	console.error("Unhandled API request error", error);
	return c.json({ success: false, error: "Internal server error" }, 500);
});

app.get("/", (c) => c.text("Hello World"));
app.get("/api/media/audio", async (c) => {
	const url = c.req.query("url") ?? "";
	const expiresText = c.req.query("expires") ?? "";
	const sizeText = c.req.query("size") ?? "";
	const signature = c.req.query("sig") ?? "";
	const size = Number(sizeText);

	if (!validExpiration(expiresText, MAX_MEDIA_AUTH_WINDOW_MS)) {
		return c.text("Expired or invalid media request", 403);
	}
	if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) return c.text("Invalid media size", 413);
	if (!isDiscordAttachmentUrl(url) || !validSignature(`${expiresText}\n${sizeText}\n${url}`, signature)) {
		return c.text("Invalid media signature", 403);
	}
	if (!ffmpegPath) return c.text("Media transcoder unavailable", 503);
	if (shuttingDown) return c.text("API server is shutting down", 503);
	if (activeTranscodes.size >= MAX_ACTIVE_TRANSCODES) return c.text("Media transcoder is busy", 429);

	let child: TranscodeChild;
	try {
		child = spawn(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-threads",
				"1",
				"-rw_timeout",
				"15000000",
				"-i",
				url,
				"-map",
				"0:a:0",
				"-vn",
				"-t",
				"1800",
				"-ac",
				"2",
				"-ar",
				"48000",
				"-codec:a",
				"libmp3lame",
				"-b:a",
				"96k",
				"-f",
				"mp3",
				"pipe:1",
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
		);
	} catch {
		return c.text("Media transcoder unavailable", 503);
	}

	const state = trackTranscode(child, c.req.raw.signal);
	const spawned = waitForSpawn(child);
	if (!child.stdout) {
		terminateTranscode(state);
		return c.text("Media transcoder unavailable", 503);
	}
	if (!(await spawned)) return c.text("Media transcoder unavailable", 503);

	return new Response(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, {
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
});

app.get("/api/transcript/:id", async (c) => {
	const id = c.req.param("id");
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
		return c.json({ success: false, error: "Invalid ticket ID" }, 400);
	}

	const expiresText = c.req.query("expires") ?? "";
	const signature = c.req.query("sig") ?? "";
	if (!validExpiration(expiresText, MAX_TRANSCRIPT_AUTH_WINDOW_MS) || !validSignature(`${expiresText}\n${id}`, signature)) {
		return c.json({ success: false, error: "Invalid or expired transcript request" }, 403);
	}

	try {
		const ticket = await Ticket.getTicketById(id);
		if (!ticket) return c.json({ success: false, error: "Ticket not found" }, 404);
		if (!ticket.transcript) return c.json({ success: false, error: "Messages not found" }, 404);
		c.header("Cache-Control", "private, no-store");
		c.header("X-Content-Type-Options", "nosniff");
		return c.json({ success: true, data: ticket.transcript });
	} catch (error) {
		console.error("Unable to load transcript", error);
		return c.json({ success: false, error: "Unable to load transcript" }, 500);
	}
});

const server = serve(
	{
		fetch: app.fetch,
		port: env.API_PORT,
	},
	(address) => {
		console.log(`Server running at ${address.port}`);
	},
);

const connectionServer = server as typeof server & {
	closeAllConnections?: () => void;
	closeIdleConnections?: () => void;
};
let shutdownPromise: Promise<void> | undefined;

function closeServer(): Promise<void> {
	return new Promise((resolve) => {
		try {
			server.close((error) => {
				if (error) {
					console.error("Unable to close API server cleanly", error);
					process.exitCode = 1;
				}
				resolve();
			});
			connectionServer.closeIdleConnections?.();
		} catch (error) {
			console.error("Unable to initiate API server shutdown", error);
			process.exitCode = 1;
			resolve();
		}
	});
}

async function performShutdown(signal: NodeJS.Signals): Promise<void> {
	shuttingDown = true;
	process.removeListener("SIGINT", shutdown);
	process.removeListener("SIGTERM", shutdown);
	console.log(`Received ${signal}; shutting down API server`);

	const transcodes = [...activeTranscodes];
	for (const state of transcodes) terminateTranscode(state);

	const forceConnectionsTimer = setTimeout(() => {
		connectionServer.closeAllConnections?.();
		for (const state of activeTranscodes) forceTerminateTranscode(state);
	}, SHUTDOWN_GRACE_PERIOD_MS);
	const shutdownDeadlineTimer = setTimeout(() => {
		console.error("API shutdown deadline exceeded; forcing process exit");
		connectionServer.closeAllConnections?.();
		for (const state of activeTranscodes) forceTerminateTranscode(state);
		process.exit(1);
	}, SHUTDOWN_DEADLINE_MS);

	try {
		await Promise.all([closeServer(), ...transcodes.map((state) => state.releasedPromise)]);
	} finally {
		clearTimeout(forceConnectionsTimer);
		clearTimeout(shutdownDeadlineTimer);
	}
}

function shutdown(signal: NodeJS.Signals): void {
	if (shutdownPromise) return;
	shutdownPromise = performShutdown(signal).catch((error) => {
		console.error("Unexpected API shutdown failure", error);
		process.exitCode = 1;
	});
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export default app;
