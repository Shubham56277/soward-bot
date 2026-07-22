import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger as loggerMiddleware } from "hono/logger";
import { Ticket } from "@repo/db";
import {cors} from "hono/cors";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { env } from "@repo/env";
import ffmpegPath from "ffmpeg-static";

const app = new Hono();
const MAX_MEDIA_BYTES = 25 * 1_024 * 1_024;
const MAX_ACTIVE_TRANSCODES = 2;
let activeTranscodes = 0;

function isDiscordAttachmentPath(pathname: string) {
	return pathname.startsWith("/attachments/") || pathname.startsWith("/ephemeral-attachments/");
}

function isDiscordAttachmentUrl(value: string) {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			(hostname === "cdn.discordapp.com" || hostname === "media.discordapp.net") &&
			isDiscordAttachmentPath(url.pathname)
		);
	} catch {
		return false;
	}
}

function validMediaSignature(url: string, expires: string, size: string, signature: string) {
	const secret = env.NODES[0]?.authorization;
	if (!secret) return false;
	const expected = createHmac("sha256", secret).update(`${expires}\n${size}\n${url}`).digest();
	let received: Buffer;
	try {
		received = Buffer.from(signature, "hex");
	} catch {
		return false;
	}
	return received.length === expected.length && timingSafeEqual(received, expected);
}

app.use(cors({
	origin: "*",
}));
app.use("*", async (c, next) => {
	// Signed Discord attachment URLs are deliberately excluded from logs.
	if (c.req.path === "/api/media/audio") return next();
	return loggerMiddleware()(c, next);
});

app.get("/", (c) => c.text("Hello World"));
app.get("/api/media/audio", (c) => {
	const url = c.req.query("url") ?? "";
	const expiresText = c.req.query("expires") ?? "";
	const sizeText = c.req.query("size") ?? "";
	const signature = c.req.query("sig") ?? "";
	const expires = Number(expiresText);
	const size = Number(sizeText);

	if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 12 * 60 * 60 * 1_000) {
		return c.text("Expired or invalid media request", 403);
	}
	if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) return c.text("Invalid media size", 413);
	if (!isDiscordAttachmentUrl(url) || !validMediaSignature(url, expiresText, sizeText, signature)) return c.text("Invalid media signature", 403);
	if (!ffmpegPath) return c.text("Media transcoder unavailable", 503);
	if (activeTranscodes >= MAX_ACTIVE_TRANSCODES) return c.text("Media transcoder is busy", 429);

	activeTranscodes += 1;
	const child = spawn(
		ffmpegPath,
		[
			"-hide_banner", "-loglevel", "error", "-nostdin",
			"-threads", "1",
			"-rw_timeout", "15000000",
			"-i", url,
			"-map", "0:a:0", "-vn", "-t", "1800",
			"-ac", "2", "-ar", "48000",
			"-codec:a", "libmp3lame", "-b:a", "96k",
			"-f", "mp3", "pipe:1",
		],
		{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
	);
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		activeTranscodes = Math.max(0, activeTranscodes - 1);
	};
	child.once("close", release);
	child.once("error", release);
	c.req.raw.signal.addEventListener("abort", () => {
		if (!child.killed) child.kill();
		release();
	}, { once: true });

	return new Response(Readable.toWeb(child.stdout) as ReadableStream, {
		headers: {
			"Content-Type": "audio/mpeg",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
});
app.get("/api/transcript/:id", async (c) => {
	const id = c.req.param("id");
	const ticket = await Ticket.getTicketById(id);
	if (!ticket) {
		return c.json({ success: false, error: "Ticket not found" }, 404);
	}
	const messages = ticket.transcript;
	if (!messages) {
		return c.json({ success: false, error: "Messages not found" }, 404);
	}
	return c.json({ success: true, data: messages });
})

serve(
	{
		fetch: app.fetch,
		port: 5173,
	},
	(address) => {
		console.log(`Server running at ${address.port}`);
	},
);

export default app;
 
