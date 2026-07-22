import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import {
	EndBehaviorType,
	VoiceConnection,
	VoiceConnectionStatus,
	entersState,
	getVoiceConnection,
	joinVoiceChannel,
} from "@discordjs/voice";
import ffmpegPath from "ffmpeg-static";
import prism from "prism-media";
import type { Guild, User, VoiceBasedChannel } from "discord.js";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const MAX_RECORDING_MS = 5 * 60 * 1_000;
const MAX_SPEAKERS = 12;
const MAX_ATTACHMENT_BYTES = 9_500_000;
const TEMP_PREFIX = "soward-recording-";
const SILENCE_CHUNK = Buffer.alloc(64 * 1_024);

interface SpeakerTrack {
	userId: string;
	filePath: string;
	fd: number;
	firstOffsetMs: number;
	bytesWritten: number;
	opusStream?: Readable;
	decoder?: prism.opus.Decoder;
}

interface ActiveRecording {
	guildId: string;
	channelId: string;
	starter: User;
	startedAt: number;
	directory: string;
	connection: VoiceConnection;
	tracks: Map<string, SpeakerTrack>;
	onSpeakingStart: (userId: string) => void;
	timeout: ReturnType<typeof setTimeout>;
	finishing: boolean;
}

const recordingGlobals = globalThis as typeof globalThis & {
	__sowardActiveVoiceRecordings?: Map<string, ActiveRecording>;
};
const sharedActiveRecordings = (recordingGlobals.__sowardActiveVoiceRecordings ??= new Map<string, ActiveRecording>());

export interface RecordingStatus {
	starterId: string;
	channelId: string;
	startedAt: number;
	speakers: number;
}

export interface RecordingResult {
	durationMs: number;
	speakers: number;
	bytes: number;
}

function cleanStaleTemporaryRecordings() {
	const root = tmpdir();
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
		const target = path.resolve(root, entry.name);
		if (path.dirname(target) !== path.resolve(root)) continue;
		if (Date.now() - statSync(target).mtimeMs < 60 * 60 * 1_000) continue;
		rmSync(target, { recursive: true, force: true });
	}
}

cleanStaleTemporaryRecordings();

function writeSilence(track: SpeakerTrack, byteCount: number) {
	let remaining = byteCount - (byteCount % (CHANNELS * BYTES_PER_SAMPLE));
	while (remaining > 0) {
		const size = Math.min(remaining, SILENCE_CHUNK.length);
		writeSync(track.fd, SILENCE_CHUNK, 0, size);
		track.bytesWritten += size;
		remaining -= size;
	}
}

function appendTimelineGap(recording: ActiveRecording, track: SpeakerTrack) {
	const relativeNowMs = Date.now() - recording.startedAt - track.firstOffsetMs;
	const targetBytes = Math.floor((relativeNowMs / 1_000) * BYTES_PER_SECOND);
	const gapBytes = targetBytes - track.bytesWritten;
	if (gapBytes > 0) writeSilence(track, gapBytes);
}

function runFfmpeg(tracks: SpeakerTrack[], outputPath: string): Promise<void> {
	const executable = ffmpegPath;
	if (!executable) throw new Error("FFmpeg binary is unavailable");

	const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
	for (const track of tracks) {
		args.push("-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-i", track.filePath);
	}

	if (tracks.length > 1) {
		const earliestOffset = Math.min(...tracks.map(track => track.firstOffsetMs));
		const filters = tracks.map((track, index) => {
			const delay = Math.max(0, Math.round(track.firstOffsetMs - earliestOffset));
			return `[${index}:a]adelay=${delay}|${delay}[speaker${index}]`;
		});
		const inputs = tracks.map((_, index) => `[speaker${index}]`).join("");
		filters.push(`${inputs}amix=inputs=${tracks.length}:duration=longest:normalize=1[mixed]`);
		args.push("-filter_complex", filters.join(";"), "-map", "[mixed]");
	}

	args.push("-codec:a", "libmp3lame", "-b:a", "64k", outputPath);

	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = `${stderr}${chunk}`.slice(-8_000);
		});
		child.once("error", reject);
		child.once("close", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`))));
	});
}

class VoiceRecordingService {
	// Commands and buttons are separate tsup entry bundles, so the registry must
	// live on globalThis for every bundled service instance to share one session.
	private readonly active = sharedActiveRecordings;

	public getStatus(guildId: string): RecordingStatus | null {
		const recording = this.active.get(guildId);
		if (!recording) return null;
		return {
			starterId: recording.starter.id,
			channelId: recording.channelId,
			startedAt: recording.startedAt,
			speakers: recording.tracks.size,
		};
	}

	public async start(guild: Guild, channel: VoiceBasedChannel, starter: User): Promise<RecordingStatus> {
		if (this.active.has(guild.id)) throw new Error("A recording is already active in this server");

		const directory = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
		mkdirSync(directory, { recursive: true });
		let connection: VoiceConnection | undefined;

		try {
			connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: guild.id,
				adapterCreator: guild.voiceAdapterCreator,
				selfDeaf: false,
				selfMute: true,
			});
			await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

			const recording = {} as ActiveRecording;
			Object.assign(recording, {
				guildId: guild.id,
				channelId: channel.id,
				starter,
				startedAt: Date.now(),
				directory,
				connection,
				tracks: new Map<string, SpeakerTrack>(),
				finishing: false,
			});

			const onSpeakingStart = (userId: string) => this.captureSpeaker(recording, userId);
			recording.onSpeakingStart = onSpeakingStart;
			connection.receiver.speaking.on("start", onSpeakingStart);
			recording.timeout = setTimeout(() => {
				this.finish(guild.id).catch(() => undefined);
			}, MAX_RECORDING_MS);

			this.active.set(guild.id, recording);
			return this.getStatus(guild.id)!;
		} catch (error) {
			connection?.destroy();
			await rm(directory, { recursive: true, force: true });
			throw error;
		}
	}

	private captureSpeaker(recording: ActiveRecording, userId: string) {
		if (recording.finishing) return;
		let track = recording.tracks.get(userId);
		if (track?.opusStream) return;

		if (!track) {
			if (recording.tracks.size >= MAX_SPEAKERS) return;
			const filePath = path.join(recording.directory, `speaker-${userId}.pcm`);
			track = {
				userId,
				filePath,
				fd: openSync(filePath, "w"),
				firstOffsetMs: Date.now() - recording.startedAt,
				bytesWritten: 0,
			};
			recording.tracks.set(userId, track);
		} else {
			appendTimelineGap(recording, track);
		}

		const opusStream = recording.connection.receiver.subscribe(userId, {
			end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
		});
		const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
		track.opusStream = opusStream;
		track.decoder = decoder;

		decoder.on("data", (chunk: Buffer) => {
			if (recording.finishing) return;
			writeSync(track!.fd, chunk);
			track!.bytesWritten += chunk.length;
		});
		decoder.once("error", () => opusStream.destroy());
		opusStream.once("error", () => decoder.destroy());
		opusStream.once("close", () => {
			if (track!.opusStream === opusStream) {
				track!.opusStream = undefined;
				track!.decoder = undefined;
			}
		});
		opusStream.pipe(decoder);
	}

	public async finish(guildId: string): Promise<RecordingResult> {
		const recording = this.active.get(guildId);
		if (!recording) throw new Error("There is no active recording in this server");
		if (recording.finishing) throw new Error("This recording is already being finalized");

		recording.finishing = true;
		this.active.delete(guildId);
		clearTimeout(recording.timeout);
		recording.connection.receiver.speaking.off("start", recording.onSpeakingStart);

		const durationMs = Date.now() - recording.startedAt;
		const outputPath = path.join(recording.directory, `recording-${Date.now()}.mp3`);

		try {
			for (const track of recording.tracks.values()) {
				track.opusStream?.unpipe();
				track.opusStream?.destroy();
				track.decoder?.removeAllListeners("data");
				track.decoder?.destroy();
				closeSync(track.fd);
			}
			if (recording.connection.state.status !== VoiceConnectionStatus.Destroyed) recording.connection.destroy();

			const tracks = [...recording.tracks.values()].filter(track => track.bytesWritten > 0);
			if (tracks.length === 0) throw new Error("No decodable speech was captured");

			await runFfmpeg(tracks, outputPath);
			const output = await stat(outputPath);
			if (output.size > MAX_ATTACHMENT_BYTES) throw new Error("The recording is too large to send through Discord");

			await recording.starter.send({
				content: `Your voice recording is ready. Duration: **${Math.ceil(durationMs / 1_000)} seconds**. The bot has deleted its temporary copy after this DM.`,
				files: [{ attachment: outputPath, name: `voice-recording-${guildId}.mp3` }],
			});

			return { durationMs, speakers: tracks.length, bytes: output.size };
		} finally {
			if (recording.connection.state.status !== VoiceConnectionStatus.Destroyed) recording.connection.destroy();
			await rm(recording.directory, { recursive: true, force: true });
		}
	}

	public async disconnect(guildId: string): Promise<boolean> {
		const recording = this.active.get(guildId);
		if (recording) {
			recording.finishing = true;
			this.active.delete(guildId);
			clearTimeout(recording.timeout);
			recording.connection.receiver.speaking.off("start", recording.onSpeakingStart);

			for (const track of recording.tracks.values()) {
				track.opusStream?.unpipe();
				track.opusStream?.destroy();
				track.decoder?.removeAllListeners("data");
				track.decoder?.destroy();
				try {
					closeSync(track.fd);
				} catch {
					// The descriptor may already be closed during a concurrent cleanup.
				}
			}

			if (recording.connection.state.status !== VoiceConnectionStatus.Destroyed) recording.connection.destroy();
			await rm(recording.directory, { recursive: true, force: true });
		}

		const connection = getVoiceConnection(guildId);
		if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
		return Boolean(recording || connection);
	}
}

export const voiceRecordingService = new VoiceRecordingService();
