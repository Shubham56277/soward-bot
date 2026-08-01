import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const JOB_DEADLINE_MS = 25_000;
const STAGE_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 400;
const STDERR_LIMIT = 8_000;
const DEFAULT_OUTPUT_LIMIT = Math.floor(7.5 * 1024 * 1024);

export interface AnimationProfile {
	width: number;
	height: number;
	fps: number;
	duration: number;
	frames: number;
	colors: number;
}

const AVATAR_PRIMARY: AnimationProfile = { width: 960, height: 540, fps: 15, duration: 3, frames: 45, colors: 128 };
const BANNER_PRIMARY: AnimationProfile = { width: 900, height: 506, fps: 12, duration: 3, frames: 36, colors: 128 };
const RETRY: AnimationProfile = { width: 800, height: 450, fps: 10, duration: 2.4, frames: 24, colors: 96 };

export function animationPlans(hasAnimatedBanner: boolean): readonly [AnimationProfile, AnimationProfile] {
	return [hasAnimatedBanner ? BANNER_PRIMARY : AVATAR_PRIMARY, RETRY];
}

export class AnimationGate {
	private active = 0;
	private readonly waiting: Array<{ resolve: (release: (() => void) | null) => void; timer: NodeJS.Timeout }> = [];

	public constructor(
		private readonly maxActive = 1,
		private readonly maxQueued = 2,
		private readonly waitTimeoutMs = 1_500,
	) {
		if (maxActive < 1 || maxActive > 4 || maxQueued < 0 || maxQueued > 16 || waitTimeoutMs < 1 || waitTimeoutMs > 10_000) {
			throw new RangeError("AnimationGate limits are outside their hard safety caps");
		}
	}

	public acquire(): Promise<(() => void) | null> {
		if (this.active < this.maxActive) {
			this.active += 1;
			return Promise.resolve(this.releaseHandle());
		}
		if (this.waiting.length >= this.maxQueued) return Promise.resolve(null);
		return new Promise((resolve) => {
			const queued = {
				resolve,
				timer: setTimeout(() => {
					const index = this.waiting.indexOf(queued);
					if (index >= 0) this.waiting.splice(index, 1);
					resolve(null);
				}, this.waitTimeoutMs),
			};
			queued.timer.unref();
			this.waiting.push(queued);
		});
	}

	public snapshot(): Readonly<{ active: number; queued: number }> {
		return { active: this.active, queued: this.waiting.length };
	}

	private releaseHandle(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = this.waiting.shift();
			if (next) {
				clearTimeout(next.timer);
				next.resolve(this.releaseHandle());
				return;
			}
			this.active = Math.max(0, this.active - 1);
		};
	}
}

const animationGate = new AnimationGate();

export interface AnimatedProfileSources {
	avatar: Buffer | null;
	banner: Buffer | null;
	avatarAnimated: boolean;
	bannerAnimated: boolean;
}

export type ProfileFramePainter = (
	avatarFrame: Buffer | null,
	bannerFrame: Buffer | null,
	width: number,
	height: number,
) => Promise<Buffer>;

export type ProfileAnimationFallbackReason =
	| "not_animated" | "saturated" | "queue_timeout" | "lease_unavailable" | "timeout"
	| "codec_unavailable" | "decode_failed" | "encode_failed" | "invalid_rgba" | "oversize";

export type ProfileAnimationResult =
	| { ok: true; buffer: Buffer; profile: AnimationProfile }
	| { ok: false; reason: ProfileAnimationFallbackReason; transient: boolean };

export type AcquireAnimationLease = () => Promise<(() => Promise<void>) | null>;

type StageFailure = "timeout" | "failed" | "oversize" | "invalid_rgba";
type StageResult<T> = { ok: true; value: T } | { ok: false; reason: StageFailure };

function isGif(buffer: Buffer | null): buffer is Buffer {
	return Boolean(buffer && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")));
}

export function expectedRgbaBytes(width: number, height: number): number {
	return width * height * 4;
}

export function selectTimelineFrameIndex(targetIndex: number, targetFps: number, sourceFps: number, sourceCount: number): number {
	if (sourceCount <= 1) return 0;
	return Math.min(sourceCount - 1, Math.max(0, Math.round((targetIndex / targetFps) * sourceFps)));
}

function remaining(deadline: number, maximum = STAGE_TIMEOUT_MS): number {
	return Math.max(1, Math.min(maximum, deadline - Date.now()));
}

async function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number | null> {
	if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
	return new Promise((resolve) => child.once("close", (code) => resolve(code)));
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		waitForClose(child).then(() => undefined),
		new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, KILL_GRACE_MS);
			timer.unref();
		}),
	]);
	if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	await waitForClose(child);
}

function spawnFfmpeg(args: string[], children: Set<ChildProcessWithoutNullStreams>): ChildProcessWithoutNullStreams | null {
	if (!ffmpegPath) return null;
	const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
	children.add(child);
	child.once("close", () => children.delete(child));
	return child;
}

async function decodeFrames(
	directory: string,
	name: string,
	buffer: Buffer | null,
	animated: boolean,
	profile: AnimationProfile,
	deadline: number,
	children: Set<ChildProcessWithoutNullStreams>,
): Promise<StageResult<string[]>> {
	if (!animated || !isGif(buffer)) return { ok: true, value: [] };
	if (deadline <= Date.now()) return { ok: false, reason: "timeout" };
	const source = path.join(directory, `${name}.gif`);
	const pattern = path.join(directory, `${name}-%03d.png`);
	await writeFile(source, buffer, { mode: 0o600 });
	const child = spawnFfmpeg([
		"-nostdin", "-hide_banner", "-loglevel", "error",
		"-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
		"-stream_loop", "-1", "-i", source,
		"-t", String(profile.duration),
		"-vf", `scale=1024:1024:force_original_aspect_ratio=decrease,fps=${profile.fps}`,
		"-frames:v", String(profile.frames), "-vsync", "0", "-y", pattern,
	], children);
	if (!child) return { ok: false, reason: "failed" };
	child.stdin.end();
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-STDERR_LIMIT); });
	child.stdout.resume();
	const timeout = remaining(deadline);
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; void stopChild(child); }, timeout);
	timer.unref();
	const code = await waitForClose(child).catch(() => null);
	clearTimeout(timer);
	if (timedOut || deadline <= Date.now()) return { ok: false, reason: "timeout" };
	if (code !== 0) return { ok: false, reason: "failed" };
	const prefix = `${name}-`;
	const frames = (await readdir(directory))
		.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".png"))
		.sort()
		.map((entry) => path.join(directory, entry));
	return frames.length === profile.frames ? { ok: true, value: frames } : { ok: false, reason: "failed" };
}

async function writeWithBackpressure(child: ChildProcessWithoutNullStreams, value: Buffer): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) return false;
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: boolean): void => {
			if (settled) return;
			settled = true;
			child.stdin.off("error", onError);
			child.stdin.off("drain", onDrain);
			child.off("close", onClose);
			resolve(result);
		};
		const onError = (): void => finish(false);
		const onDrain = (): void => finish(true);
		const onClose = (): void => finish(false);
		child.stdin.once("error", onError);
		child.once("close", onClose);
		const accepted = child.stdin.write(value, (error) => {
			if (error) finish(false);
			else if (accepted) finish(true);
		});
		if (!accepted) child.stdin.once("drain", onDrain);
	});
}

async function encodeRawGif(
	profile: AnimationProfile,
	frames: AsyncIterable<Buffer>,
	outputLimit: number,
	deadline: number,
	children: Set<ChildProcessWithoutNullStreams>,
): Promise<StageResult<Buffer>> {
	if (deadline <= Date.now()) return { ok: false, reason: "timeout" };
	const child = spawnFfmpeg([
		"-nostdin", "-hide_banner", "-loglevel", "error",
		"-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
		"-f", "rawvideo", "-pixel_format", "rgba",
		"-video_size", `${profile.width}x${profile.height}`,
		"-framerate", String(profile.fps), "-i", "pipe:0",
		"-filter_complex", `[0:v]split[a][b];[a]palettegen=max_colors=${profile.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
		"-loop", "0", "-f", "gif", "pipe:1",
	], children);
	if (!child) return { ok: false, reason: "failed" };
	let stderr = "";
	const output: Buffer[] = [];
	let outputBytes = 0;
	let oversized = false;
	let timedOut = false;
	let streamFailed = false;
	child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-STDERR_LIMIT); });
	child.stdout.on("data", (chunk: Buffer) => {
		if (oversized) return;
		const remainingBytes = outputLimit + 1 - outputBytes;
		if (remainingBytes > 0) {
			const part = chunk.length > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;
			output.push(Buffer.from(part));
			outputBytes += part.length;
		}
		if (outputBytes > outputLimit || chunk.length > remainingBytes) {
			oversized = true;
			void stopChild(child);
		}
	});
	child.stdin.on("error", () => { streamFailed = true; });
	const timer = setTimeout(() => { timedOut = true; void stopChild(child); }, remaining(deadline));
	timer.unref();
	try {
		let count = 0;
		for await (const frame of frames) {
			if (timedOut || oversized || child.exitCode !== null || deadline <= Date.now()) break;
			if (frame.length !== expectedRgbaBytes(profile.width, profile.height)) {
				await stopChild(child);
				return { ok: false, reason: "invalid_rgba" };
			}
			if (!(await writeWithBackpressure(child, frame))) { streamFailed = true; break; }
			count += 1;
		}
		if (!child.stdin.destroyed) child.stdin.end();
		const code = await waitForClose(child).catch(() => null);
		if (timedOut || deadline <= Date.now()) return { ok: false, reason: "timeout" };
		if (oversized) return { ok: false, reason: "oversize" };
		if (streamFailed || code !== 0) return { ok: false, reason: "failed" };
		const value = Buffer.concat(output, outputBytes);
		return value.length > 0 && value.length <= outputLimit
			? { ok: true, value }
			: { ok: false, reason: value.length > outputLimit ? "oversize" : "failed" };
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null) await stopChild(child);
	}
}

function fallback(reason: ProfileAnimationFallbackReason): ProfileAnimationResult {
	return {
		ok: false,
		reason,
		transient: ["saturated", "queue_timeout", "lease_unavailable", "timeout", "codec_unavailable", "encode_failed"].includes(reason),
	};
}

function frameGenerator(
	profile: AnimationProfile,
	primary: AnimationProfile,
	avatarFrames: readonly string[],
	bannerFrames: readonly string[],
	paint: ProfileFramePainter,
): AsyncIterable<Buffer> {
	return {
		async *[Symbol.asyncIterator]() {
			for (let index = 0; index < profile.frames; index += 1) {
				const primaryIndex = profile === primary
					? index
					: selectTimelineFrameIndex(index, profile.fps, primary.fps, primary.frames);
				const [avatar, banner] = await Promise.all([
					avatarFrames.length ? readFile(avatarFrames[Math.min(primaryIndex, avatarFrames.length - 1)]!) : Promise.resolve(null),
					bannerFrames.length ? readFile(bannerFrames[Math.min(primaryIndex, bannerFrames.length - 1)]!) : Promise.resolve(null),
				]);
				yield await paint(avatar, banner, profile.width, profile.height);
			}
		},
	};
}

export async function composeAnimatedProfile(
	sources: AnimatedProfileSources,
	paint: ProfileFramePainter,
	outputLimit = DEFAULT_OUTPUT_LIMIT,
	acquireLease?: AcquireAnimationLease,
): Promise<ProfileAnimationResult> {
	const avatarMoves = sources.avatarAnimated && isGif(sources.avatar);
	const bannerMoves = sources.bannerAnimated && isGif(sources.banner);
	if (!avatarMoves && !bannerMoves) return fallback("not_animated");
	if (!ffmpegPath) return fallback("codec_unavailable");
	const before = animationGate.snapshot();
	const releaseLocal = await animationGate.acquire();
	if (!releaseLocal) return fallback(before.queued >= 2 ? "saturated" : "queue_timeout");
	let releaseLease: (() => Promise<void>) | null = null;
	let root: string | null = null;
	const children = new Set<ChildProcessWithoutNullStreams>();
	const deadline = Date.now() + JOB_DEADLINE_MS;
	try {
		if (acquireLease) {
			try { releaseLease = await acquireLease(); } catch { return fallback("lease_unavailable"); }
			if (!releaseLease) return fallback("lease_unavailable");
		}
		root = await mkdtemp(path.join(tmpdir(), "elfaria-profile-"));
		await chmod(root, 0o700).catch(() => undefined);
		const [primary, retry] = animationPlans(bannerMoves);
		const [avatarResult, bannerResult] = await Promise.all([
			decodeFrames(root, "avatar", sources.avatar, avatarMoves, primary, deadline, children),
			decodeFrames(root, "banner", sources.banner, bannerMoves, primary, deadline, children),
		]);
		if (!avatarResult.ok || !bannerResult.ok) {
			return fallback(avatarResult.reason === "timeout" || bannerResult.reason === "timeout" ? "timeout" : "decode_failed");
		}
		if ((avatarMoves && !avatarResult.value.length) || (bannerMoves && !bannerResult.value.length)) return fallback("decode_failed");
		let lastFailure: StageFailure = "failed";
		for (const profile of [primary, retry]) {
			if (deadline <= Date.now()) return fallback("timeout");
			const result = await encodeRawGif(
				profile,
				frameGenerator(profile, primary, avatarResult.value, bannerResult.value, paint),
				outputLimit,
				deadline,
				children,
			);
			if (result.ok) return { ok: true, buffer: result.value, profile };
			lastFailure = result.reason;
			if (result.reason === "timeout" || result.reason === "invalid_rgba") break;
		}
		if (lastFailure === "timeout") return fallback("timeout");
		if (lastFailure === "oversize") return fallback("oversize");
		if (lastFailure === "invalid_rgba") return fallback("invalid_rgba");
		return fallback("encode_failed");
	} catch {
		return fallback(deadline <= Date.now() ? "timeout" : "encode_failed");
	} finally {
		await Promise.all([...children].map((child) => stopChild(child).catch(() => undefined)));
		if (root) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
		if (releaseLease) await releaseLease().catch(() => undefined);
		releaseLocal();
	}
}
