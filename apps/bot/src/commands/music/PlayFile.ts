import { ApplicationCommandOptionType, EmbedBuilder, VoiceChannel } from "discord.js";
import type { SearchResult } from "lavalink-client";
import { createHmac } from "node:crypto";
import { env } from "@repo/env";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { isDiscordAttachmentUrl } from "../../utils/musicSources";

const MAX_FILE_BYTES = 25 * 1_024 * 1_024;
const ALLOWED_EXTENSIONS = new Set(["mp3", "mp4", "m4a", "wav", "ogg", "opus", "flac", "webm", "aac"]);
const RELEASE_LOCK_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function mediaSourceUrl(url: string, size: number, extension: string) {
	if (extension !== "mp4" && extension !== "webm") return url;
	if (!env.MEDIA_PROXY_URL) throw new Error("MEDIA_PROXY_URL is not configured");
	const expiresText = String(Date.now() + 6 * 60 * 60 * 1_000);
	const sizeText = String(size);
	const secret = env.NODES[0]?.authorization;
	if (!secret) throw new Error("Lavalink authorization is unavailable");
	const signature = createHmac("sha256", secret).update(`${expiresText}\n${sizeText}\n${url}`).digest("hex");
	const proxy = new URL("/api/media/audio", env.MEDIA_PROXY_URL);
	proxy.searchParams.set("url", url);
	proxy.searchParams.set("expires", expiresText);
	proxy.searchParams.set("size", sizeText);
	proxy.searchParams.set("sig", signature);
	return proxy.toString();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error("File loading timed out")), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

export default class PlayFile extends Command {
	constructor() {
		super({
			name: "playfile",
			description: {
				content: "Use `/playfile` to play audio from an uploaded MP3, MP4, or supported audio file",
				examples: ["playfile <attach a file>"],
				usage: "playfile <attachment>",
			},
			category: "music",
			aliases: ["pf", "fileplay"],
			cooldown: 5,
			args: false,
			premium: true,
			player: { voice: true, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Connect", "Speak"],
				user: [],
			},
            slashCommand: false,
			options: [
				{
					name: "file",
					description: "Upload an MP3, MP4, or other supported audio file (maximum 25 MB)",
					type: ApplicationCommandOptionType.Attachment,
					required: true,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const attachment = ctx.options.getAttachment("file", true, 0);
		if (!attachment) return ctx.sendMessage("Attach an MP3, MP4, or supported audio file.");

		const extension = attachment.name.split(".").pop()?.toLowerCase() ?? "";
		const acceptedContentType =
			attachment.contentType?.startsWith("audio/") ||
			attachment.contentType === "video/mp4" ||
			attachment.contentType === "video/webm" ||
			attachment.contentType === "application/ogg";
		if (!ALLOWED_EXTENSIONS.has(extension) || (!acceptedContentType && attachment.contentType)) {
			return ctx.sendMessage("Unsupported file. Use MP3, MP4, M4A, WAV, OGG, OPUS, FLAC, WEBM, or AAC.");
		}
		if (attachment.size > MAX_FILE_BYTES) return ctx.sendMessage("The uploaded file must be 25 MB or smaller.");
		if (!isDiscordAttachmentUrl(attachment.url)) return ctx.sendMessage("Only files uploaded directly to Discord are accepted.");

		const lockKey = `music:playfile:${ctx.guild.id}`;
		const lockToken = ctx.id;
		const locked = await ctx.client.redis.set(lockKey, lockToken, "EX", 30, "NX");
		if (!locked) return ctx.sendMessage("Another uploaded file is already being processed in this server. Try again shortly.");

		await ctx.sendDeferMessage("Loading the uploaded audio...");
		const embed = new EmbedBuilder()
			.setTimestamp()
			.setFooter({ text: `Requested by ${ctx.author?.username}`, iconURL: ctx.author?.displayAvatarURL() });

		try {
			const voiceChannel = ctx.member?.voice.channel as VoiceChannel | null;
			if (!voiceChannel) return ctx.editMessage({ content: "Join a voice channel first." });

			let player = ctx.client.manager.getPlayer(ctx.guild.id);
			if (!player) {
				player = ctx.client.manager.createPlayer({
					guildId: ctx.guild.id,
					voiceChannelId: voiceChannel.id,
					textChannelId: ctx.channel.id,
					selfMute: false,
					selfDeaf: true,
					vcRegion: voiceChannel.rtcRegion!,
				});
			}

			const sourceUrl = mediaSourceUrl(attachment.url, attachment.size, extension);
			const [searchResult] = await Promise.all([
				withTimeout(player.search({ query: sourceUrl }, ctx.author), 20_000),
				player.connected ? Promise.resolve() : withTimeout(player.connect(), 10_000),
			]);
			const response = searchResult as SearchResult;
			const track = response.tracks?.[0];
			if (!track) {
				return ctx.editMessage({ content: "", embeds: [embed.setColor(ctx.client.config.colors.red).setDescription("Lavalink could not read audio from that file.")] });
			}
			track.info.title = attachment.name.replace(/\.[^.]+$/, "");
			track.info.author = ctx.author?.username || "Discord upload";

			await player.queue.add(track);
			await ctx.client.redis.setex(
				`music:playfile:last:${ctx.guild.id}`,
				300,
				JSON.stringify({ userId: ctx.author?.id, name: attachment.name, size: attachment.size, queuedAt: Date.now() }),
			);
			await ctx.editMessage({
				content: "",
				embeds: [
					embed
						.setColor(ctx.client.config.colors.main)
						.setTitle("Uploaded Audio Added")
						.setDescription(`**${attachment.name}** was added to the queue.\nSize: **${(attachment.size / 1_024 / 1_024).toFixed(2)} MB**\nThe bot streams it directly from Discord and does not save the file.`),
				],
			});

			if (!player.playing && player.queue.tracks.length > 0) await player.play({ paused: false });
		} catch (error) {
			ctx.client.logger.error("[playfile] Failed to stream attachment", error);
			return ctx.editMessage({ content: "", embeds: [embed.setColor(ctx.client.config.colors.red).setDescription("I couldn't load that file. Check the format and try again.")] });
		} finally {
			await ctx.client.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken).catch(() => undefined);
		}
	}
}
