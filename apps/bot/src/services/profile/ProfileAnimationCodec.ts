import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const PROCESS_TIMEOUT_MS = 15_000;
const STDERR_LIMIT = 8_000;
const MAX_ANIMATIONS = 2;

interface AnimationProfile {
	width: number;
	height: number;
	fps: number;
	duration: number;
	colors: number;
}

const PROFILES: readonly AnimationProfile[] = [
	{ width: 960, height: 540, fps: 8, duration: 3, colors: 128 },
	{ width: 800, height: 450, fps: 6, duration: 2.5, colors: 96 },
];

class Semaphore {
	private active = 0;
	private readonly waiting: Array<() => void> = [];

	public async acquire(): Promise<() => void> {
		if (this.active >= MAX_ANIMATIONS) await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.active += 1;
		return () => {
			this.active -= 1;
			this.waiting.shift()?.();
		};
	}
}

const animationSlots = new Semaphore();

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

function isGif(buffer: Buffer | null): buffer is Buffer {
	return Boolean(buffer && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")));
}
async function runFfmpeg(args: string[]): Promise<boolean> {
	const executable = ffmpegPath;
	if (!executable) return false;
	return new Promise((resolve) => {
		const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		let settled = false;
		const finish = (success: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(success);
		};
		child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT); });
		child.once("error", () => finish(false));
		child.once("close", (code) => finish(code === 0));
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(false);
		}, PROCESS_TIMEOUT_MS);
		timer.unref();
	});
}

async function decodeFrames(
	directory: string,
	name: string,
	buffer: Buffer | null,
	animated: boolean,
	profile: AnimationProfile,
): Promise<string[]> {
	if (!animated || !isGif(buffer)) return [];
	const source = path.join(directory, `${name}.gif`);
	const pattern = path.join(directory, `${name}-%03d.png`);
	await writeFile(source, buffer);
	const frameLimit = Math.min(32, Math.ceil(profile.fps * profile.duration));
	const ok = await runFfmpeg([
		"-hide_banner", "-loglevel", "error", "-i", source,
		"-t", String(profile.duration), "-vf", `fps=${profile.fps}`, "-frames:v", String(frameLimit), "-vsync", "0", "-y", pattern,
	]);
	if (!ok) return [];
	const prefix = `${name}-`;
	return (await readdir(directory))
		.filter((entry) => entry.startsWith(prefix) && entry.endsWith(".png"))
		.sort()
		.map((entry) => path.join(directory, entry));
}

async function encodeGif(directory: string, profile: AnimationProfile): Promise<Buffer | null> {
	const pattern = path.join(directory, "card-%03d.png");
	const palette = path.join(directory, "palette.png");
	const output = path.join(directory, "profile.gif");
	const paletteOk = await runFfmpeg([
		"-hide_banner", "-loglevel", "error", "-framerate", String(profile.fps), "-i", pattern,
		"-vf", `palettegen=max_colors=${profile.colors}:stats_mode=diff`, "-frames:v", "1", "-y", palette,
	]);
	if (!paletteOk) return null;
	const encodeOk = await runFfmpeg([
		"-hide_banner", "-loglevel", "error", "-framerate", String(profile.fps), "-i", pattern,
		"-i", palette, "-lavfi", "paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
		"-loop", "0", "-y", output,
	]);
	if (!encodeOk) return null;
	return readFile(output).catch(() => null);
}
export async function composeAnimatedProfile(
	sources: AnimatedProfileSources,
	paint: ProfileFramePainter,
	outputLimit: number,
): Promise<Buffer | null> {
	if ((!sources.avatarAnimated || !isGif(sources.avatar)) && (!sources.bannerAnimated || !isGif(sources.banner))) return null;
	const release = await animationSlots.acquire();
	const root = await mkdtemp(path.join(tmpdir(), "elfaria-profile-"));
	try {
		for (let attempt = 0; attempt < PROFILES.length; attempt += 1) {
			const profile = PROFILES[attempt]!;
			const directory = path.join(root, `attempt-${attempt}`);
			await mkdir(directory, { recursive: true });
			const [avatarFrames, bannerFrames] = await Promise.all([
				decodeFrames(directory, "avatar", sources.avatar, sources.avatarAnimated, profile),
				decodeFrames(directory, "banner", sources.banner, sources.bannerAnimated, profile),
			]);
			const avatarMoves = avatarFrames.length > 1;
			const bannerMoves = bannerFrames.length > 1;
			if (!avatarMoves && !bannerMoves) return null;
			const frameCount = Math.min(32, Math.max(avatarMoves ? avatarFrames.length : 0, bannerMoves ? bannerFrames.length : 0));
			for (let index = 0; index < frameCount; index += 1) {
				const avatarPath = avatarMoves ? avatarFrames[index % avatarFrames.length]! : null;
				const bannerPath = bannerMoves ? bannerFrames[index % bannerFrames.length]! : null;
				const [avatarFrame, bannerFrame] = await Promise.all([
					avatarPath ? readFile(avatarPath) : Promise.resolve(sources.avatar),
					bannerPath ? readFile(bannerPath) : Promise.resolve(sources.banner),
				]);
				const card = await paint(avatarFrame, bannerFrame, profile.width, profile.height);
				await writeFile(path.join(directory, `card-${String(index + 1).padStart(3, "0")}.png`), card);
			}
			const output = await encodeGif(directory, profile);
			if (output && output.length <= outputLimit && (await stat(path.join(directory, "profile.gif"))).isFile()) return output;
		}
		return null;
	} catch {
		return null;
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
		release();
	}
}
