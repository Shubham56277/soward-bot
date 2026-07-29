import { Playlist as PlaylistStore, type PlaylistTrackData } from "@repo/db";
import { ApplicationCommandOptionType, VoiceChannel } from "discord.js";
import type { SearchResult, Track } from "lavalink-client";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { TimeFormat } from "../../utils/timeFormat";

const MAX_NAME_LENGTH = 32;
const MAX_PLAYLISTS = 25;
const MAX_TRACKS = 100;
const INFO_TRACK_PREVIEW = 15;
/** Never ping anyone when rendering panels. */
const NO_PING = { parse: [] as const };

type ManagedPlayer = NonNullable<ReturnType<Context["client"]["manager"]["getPlayer"]>>;

const nameOption = (description: string): any => ({
	name: "name",
	description,
	type: ApplicationCommandOptionType.String,
	required: true,
	min_length: 1,
	max_length: MAX_NAME_LENGTH,
});

/**
 * Personal playlists for premium users. Every playlist belongs to the member who
 * created it, so playlists follow them across every server the bot is in.
 */
export default class Playlist extends Command {
	public constructor() {
		super({
			name: "playlist",
			description: {
				content: "Create and manage personal playlists",
				usage: "playlist <create|delete|rename|list|info|add|remove|play> [name] [value]",
				examples: [
					"playlist",
					"playlist create chill",
					"playlist add chill lofi beats",
					"playlist add chill",
					"playlist remove chill 2",
					"playlist info chill",
					"playlist rename chill focus",
					"playlist play chill",
					"playlist delete chill",
				],
			},
			category: "music",
			aliases: ["pl"],
			cooldown: 5,
			args: false,
			premium: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Connect", "Speak"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "create",
					description: "Create an empty playlist",
					type: ApplicationCommandOptionType.Subcommand,
					options: [nameOption("A name for the new playlist")],
				},
				{
					name: "delete",
					description: "Delete one of your playlists",
					type: ApplicationCommandOptionType.Subcommand,
					options: [nameOption("The playlist to delete")],
				},
				{
					name: "rename",
					description: "Rename one of your playlists",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						nameOption("The playlist to rename"),
						{
							name: "new_name",
							description: "The new playlist name",
							type: ApplicationCommandOptionType.String,
							required: true,
							min_length: 1,
							max_length: MAX_NAME_LENGTH,
						},
					],
				},
				{ name: "list", description: "List your playlists", type: ApplicationCommandOptionType.Subcommand },
				{
					name: "info",
					description: "Show a playlist and its tracks",
					type: ApplicationCommandOptionType.Subcommand,
					options: [nameOption("The playlist to inspect")],
				},
				{
					name: "add",
					description: "Add a track to a playlist",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						nameOption("The playlist to add to"),
						{
							name: "query",
							description: "Song name or URL. Omit it to add the current track",
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: "remove",
					description: "Remove a track from a playlist",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						nameOption("The playlist to edit"),
						{
							name: "index",
							description: "Position of the track to remove",
							type: ApplicationCommandOptionType.Integer,
							required: true,
							min_value: 1,
							max_value: MAX_TRACKS,
						},
					],
				},
				{
					name: "play",
					description: "Load a playlist into the queue and start playback",
					type: ApplicationCommandOptionType.Subcommand,
					options: [nameOption("The playlist to play")],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			// `?playlist` with no subcommand opens the dashboard.
			const rawAction = ctx.options.getSubCommand(false, 0);
			if (!rawAction || typeof rawAction !== "string") return await this.dashboard(ctx);

			switch (rawAction.toLowerCase()) {
				case "create":
					return await this.create(ctx);
				case "delete":
					return await this.remove(ctx);
				case "rename":
					return await this.rename(ctx);
				case "list":
					return await this.list(ctx);
				case "info":
					return await this.info(ctx);
				case "add":
					return await this.addTrack(ctx);
				case "remove":
					return await this.removeTrack(ctx);
				case "play":
					return await this.play(ctx);
				default:
					return await this.dashboard(ctx);
			}
		} catch (error) {
			return settingsFailure(ctx, error, "playlist");
		}
	}

	// ─── Dashboard ──────────────────────────────────────────────────────────

	private async dashboard(ctx: Context): Promise<any> {
		const playlists = await PlaylistStore.getAll(ctx.author!.id);
		return this.send(
			ctx,
			settingsPanel("Playlists", `Save songs to personal playlists and replay them in any server. You can keep up to ${MAX_PLAYLISTS} playlists with ${MAX_TRACKS} tracks each.`, [
				["Your playlists", `${playlists.length} of ${MAX_PLAYLISTS} used`],
				["Create", "`playlist create <name>`\nCreate a new empty playlist."],
				["Delete", "`playlist delete <name>`\nDelete one of your playlists."],
				["Rename", "`playlist rename <old> <new>`\nRename an existing playlist."],
				["List", "`playlist list`\nShow every playlist with its track count."],
				["Info", "`playlist info <name>`\nShow a playlist and its first tracks."],
				["Add", "`playlist add <name> [query]`\nAdd a search result, a URL, or the current track."],
				["Remove", "`playlist remove <name> <index>`\nRemove a track by its position."],
				["Play", "`playlist play <name>`\nLoad the whole playlist into the queue."],
			]),
		);
	}

	// ─── Playlist management ────────────────────────────────────────────────

	private async create(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", `Provide a playlist name of 1-${MAX_NAME_LENGTH} characters. Usage: \`playlist create <name>\`.`);

		const playlists = await PlaylistStore.getAll(ctx.author!.id);
		if (playlists.length >= MAX_PLAYLISTS) return this.notice(ctx, "Playlist limit reached", `You already have ${MAX_PLAYLISTS} playlists. Delete one before creating another.`);
		if (playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
			return this.notice(ctx, "Name already used", `You already have a playlist called \`${name}\`. Pick another name.`);
		}

		const created = await PlaylistStore.create(ctx.author!.id, name);
		if (!created) return this.notice(ctx, "Name already used", `You already have a playlist called \`${name}\`. Pick another name.`);
		return this.notice(ctx, "Playlist created", `\`${created.name}\` is ready. Add songs with \`playlist add ${created.name} <query>\`.`);
	}

	private async remove(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", "Provide the playlist to delete. Usage: `playlist delete <name>`.");

		const playlist = await this.find(ctx, name);
		if (!playlist) return this.missing(ctx, name);
		await PlaylistStore.delete(ctx.author!.id, playlist.name);
		return this.notice(ctx, "Playlist deleted", `\`${playlist.name}\` and all of its tracks were removed.`);
	}

	private async rename(ctx: Context): Promise<any> {
		const oldName = this.readName(ctx, "name", 1);
		const newName = this.readName(ctx, "new_name", 2);
		if (!oldName || !newName) return this.notice(ctx, "Two names required", `Provide the current and the new name of 1-${MAX_NAME_LENGTH} characters. Usage: \`playlist rename <old> <new>\`.`);

		const playlist = await this.find(ctx, oldName);
		if (!playlist) return this.missing(ctx, oldName);
		if (playlist.name === newName) return this.notice(ctx, "Nothing changed", `\`${playlist.name}\` already uses that name.`);

		const taken = await this.find(ctx, newName);
		if (taken) return this.notice(ctx, "Name already used", `You already have a playlist called \`${taken.name}\`. Pick another name.`);

		const renamed = await PlaylistStore.rename(ctx.author!.id, playlist.name, newName);
		if (!renamed) return this.missing(ctx, oldName);
		return this.notice(ctx, "Playlist renamed", `\`${playlist.name}\` is now \`${renamed.name}\`.`);
	}

	private async list(ctx: Context): Promise<any> {
		const playlists = await PlaylistStore.getAll(ctx.author!.id);
		if (!playlists.length) return this.notice(ctx, "No playlists yet", "Create your first one with `playlist create <name>`.");

		const counts = await Promise.all(playlists.map((playlist) => PlaylistStore.countTracks(playlist.id)));
		const lines = playlists.map((playlist, index) => `**${index + 1}.** \`${playlist.name}\` — ${counts[index]} track${counts[index] === 1 ? "" : "s"}`);
		return this.send(ctx, settingsPanel("Your playlists", `${playlists.length} of ${MAX_PLAYLISTS} used.`, [["Playlists", lines.join("\n")]]));
	}

	private async info(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", "Provide the playlist to inspect. Usage: `playlist info <name>`.");

		const playlist = await this.find(ctx, name);
		if (!playlist) return this.missing(ctx, name);

		const tracks = await PlaylistStore.getTracks(playlist.id);
		const total = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
		const preview = tracks.slice(0, INFO_TRACK_PREVIEW).map((track) => `**${track.position}.** ${this.trackLabel(track)}`);
		const extra = tracks.length > preview.length ? `\n-# and ${tracks.length - preview.length} more` : "";

		return this.send(
			ctx,
			settingsPanel("Playlist details", `Details for \`${playlist.name}\`.`, [
				["Tracks", `${tracks.length} of ${MAX_TRACKS}`],
				["Total length", total > 0 ? TimeFormat.toDotted(total) : "Unknown"],
				["Created", `<t:${Math.floor(playlist.createdAt.getTime() / 1_000)}:R>`],
				["Songs", tracks.length ? `${preview.join("\n")}${extra}` : `This playlist is empty. Add songs with \`playlist add ${playlist.name} <query>\`.`],
			]),
		);
	}

	// ─── Track management ───────────────────────────────────────────────────

	private async addTrack(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", "Provide the playlist to add to. Usage: `playlist add <name> [query]`.");

		const playlist = await this.find(ctx, name);
		if (!playlist) return this.missing(ctx, name);

		const count = await PlaylistStore.countTracks(playlist.id);
		if (count >= MAX_TRACKS) return this.notice(ctx, "Playlist full", `\`${playlist.name}\` already holds ${MAX_TRACKS} tracks. Remove one before adding another.`);

		const query = this.readQuery(ctx);
		let track: Track | undefined;

		if (query) {
			let result: SearchResult | undefined;
			try {
				result = await ctx.client.manager.search(query, ctx.author);
			} catch (error) {
				ctx.client.logger.error("[playlist] search failed", error);
				return this.notice(ctx, "Search failed", "The music server could not be reached. Try again in a moment.");
			}
			track = result?.tracks?.[0];
			if (!track) return this.notice(ctx, "No results", `Nothing was found for \`${query.slice(0, 80)}\`.`);
		} else {
			track = ctx.client.manager.getPlayer(ctx.guild.id)?.queue.current ?? undefined;
			if (!track) return this.notice(ctx, "Nothing playing", "Nothing is playing right now. Provide a song name or URL instead.");
		}

		const uri = track.info?.uri;
		if (!uri) return this.notice(ctx, "Track unavailable", "That track has no playable link, so it cannot be saved.");

		const stored = await PlaylistStore.addTrack(playlist.id, {
			title: track.info.title ?? null,
			uri,
			author: track.info.author ?? null,
			duration: typeof track.info.duration === "number" ? Math.floor(track.info.duration) : null,
		});
		if (!stored) return this.notice(ctx, "Not saved", "The track could not be saved. Try again in a moment.");

		return this.notice(ctx, "Track added", `Added **${this.plain(stored.title ?? uri)}** to \`${playlist.name}\` at position **${stored.position}**.`);
	}

	private async removeTrack(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", "Provide the playlist to edit. Usage: `playlist remove <name> <index>`.");

		const playlist = await this.find(ctx, name);
		if (!playlist) return this.missing(ctx, name);

		const raw = ctx.isInteraction ? ctx.options.getInteger("index", false) : ctx.args[2];
		const index = Number.parseInt(String(raw ?? ""), 10);
		const count = await PlaylistStore.countTracks(playlist.id);
		if (!count) return this.notice(ctx, "Playlist empty", `\`${playlist.name}\` has no tracks to remove.`);
		if (!Number.isInteger(index) || index < 1 || index > count) {
			return this.notice(ctx, "Invalid position", `Provide a position between **1** and **${count}**. Usage: \`playlist remove ${playlist.name} <index>\`.`);
		}

		const removed = await PlaylistStore.removeTrack(playlist.id, index);
		if (!removed) return this.notice(ctx, "Invalid position", `There is no track at position **${index}** in \`${playlist.name}\`.`);
		return this.notice(ctx, "Track removed", `Removed **${this.plain(removed.title ?? removed.uri)}** from \`${playlist.name}\`. ${count - 1} track${count - 1 === 1 ? "" : "s"} left.`);
	}

	// ─── Playback ───────────────────────────────────────────────────────────

	private async play(ctx: Context): Promise<any> {
		const name = this.readName(ctx, "name", 1);
		if (!name) return this.notice(ctx, "Name required", "Provide the playlist to play. Usage: `playlist play <name>`.");

		const playlist = await this.find(ctx, name);
		if (!playlist) return this.missing(ctx, name);

		const stored = await PlaylistStore.getTracks(playlist.id);
		if (!stored.length) return this.notice(ctx, "Playlist empty", `\`${playlist.name}\` has no tracks yet. Add some with \`playlist add ${playlist.name} <query>\`.`);

		const { client } = ctx;
		const availableNodes = [...client.manager.nodeManager.nodes.values()].filter((node) => node.connected);
		if (!availableNodes.length) return this.notice(ctx, "Music server offline", "The music server is unavailable right now. Try again in a moment.");

		const memberVoice = (ctx.member as any)?.voice?.channel as VoiceChannel | undefined;
		if (!memberVoice) return this.notice(ctx, "Voice channel required", "Join a voice channel first, then run the command again.");

		let player = client.manager.getPlayer(ctx.guild.id);
		if (!player) {
			player = client.manager.createPlayer({
				guildId: ctx.guild.id,
				voiceChannelId: memberVoice.id,
				textChannelId: ctx.channel.id,
				selfMute: false,
				selfDeaf: true,
				vcRegion: memberVoice.rtcRegion ?? undefined,
			});
		}

		try {
			if (!player.connected) await player.connect();
		} catch (error) {
			client.logger.error("[playlist] voice connect failed", error);
			return this.notice(ctx, "Connection failed", "I could not connect to your voice channel. Check my permissions and try again.");
		}

		const resolved = await this.resolveTracks(ctx, player, stored);
		if (!resolved.length) return this.notice(ctx, "Nothing playable", `None of the tracks in \`${playlist.name}\` could be loaded right now.`);

		const wasEmpty = !player.playing && player.queue.tracks.length === 0;
		await player.queue.add(resolved);
		if (wasEmpty && player.queue.tracks.length > 0) await player.play({ paused: false });

		const skipped = stored.length - resolved.length;
		return this.notice(
			ctx,
			"Playlist queued",
			`Added **${resolved.length}** track${resolved.length === 1 ? "" : "s"} from \`${playlist.name}\` to the queue.${skipped > 0 ? `\n-# ${skipped} track${skipped === 1 ? "" : "s"} could not be loaded.` : ""}`,
		);
	}

	/** Re-resolve stored URIs through Lavalink, in small batches to keep latency low. */
	private async resolveTracks(ctx: Context, player: ManagedPlayer, stored: PlaylistTrackData[]): Promise<Track[]> {
		const resolved: Track[] = [];
		for (let index = 0; index < stored.length; index += 5) {
			const batch = stored.slice(index, index + 5);
			const results = await Promise.all(
				batch.map(async (entry) => {
					try {
						const result = (await player.search({ query: entry.uri }, ctx.author)) as SearchResult;
						return result?.tracks?.[0];
					} catch (error: any) {
						ctx.client.logger.warn(`[playlist] could not load ${entry.uri}: ${error?.message ?? error}`);
						return undefined;
					}
				}),
			);
			for (const track of results) if (track) resolved.push(track);
		}
		return resolved;
	}

	// ─── Helpers ────────────────────────────────────────────────────────────

	/** Reads and validates a playlist name from a slash option or a prefix argument. */
	private readName(ctx: Context, option: string, position: number): string | null {
		const raw = ctx.isInteraction ? ctx.options.getString(option, false) : ctx.args[position];
		if (typeof raw !== "string") return null;
		const value = raw.trim();
		if (!value.length || value.length > MAX_NAME_LENGTH) return null;
		return value;
	}

	/** Optional search query: everything after the playlist name for prefix usage. */
	private readQuery(ctx: Context): string | null {
		const raw = ctx.isInteraction ? ctx.options.getString("query", false) : ctx.args.slice(2).join(" ");
		if (typeof raw !== "string") return null;
		const value = raw.trim();
		return value.length ? value : null;
	}

	/** Case-insensitive lookup so prefix users do not have to match casing. */
	private async find(ctx: Context, name: string) {
		const exact = await PlaylistStore.get(ctx.author!.id, name);
		if (exact) return exact;
		const all = await PlaylistStore.getAll(ctx.author!.id);
		return all.find((playlist) => playlist.name.toLowerCase() === name.toLowerCase()) ?? null;
	}

	private trackLabel(track: PlaylistTrackData): string {
		const title = this.plain(track.title ?? track.uri).slice(0, 70);
		const author = track.author ? ` — ${this.plain(track.author).slice(0, 40)}` : "";
		const duration = track.duration && track.duration > 0 ? ` \`${TimeFormat.toDotted(track.duration)}\`` : "";
		return `${title}${author}${duration}`;
	}

	/** Strips markdown control characters so stored titles cannot break the panel. */
	private plain(value: string): string {
		return value.replace(/[*_`~|\\]/g, "");
	}

	private missing(ctx: Context, name: string): Promise<any> {
		return this.notice(ctx, "Playlist not found", `You have no playlist called \`${name}\`. Use \`playlist list\` to see your playlists.`);
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return this.send(ctx, settingsPanel(title, body));
	}

	private send(ctx: Context, panel: ReturnType<typeof settingsPanel>): Promise<any> {
		return ctx.sendMessage({ components: [panel], flags: SETTINGS_FLAGS, allowedMentions: NO_PING });
	}
}
