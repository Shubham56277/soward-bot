import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	escapeMarkdown,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import type { Player, Track } from "lavalink-client";
import { TimeFormat } from "./timeFormat";

const FALLBACK_ARTWORK = "https://cdn.discordapp.com/embed/avatars/0.png";

function progressBar(current: number, total: number, size = 18): string {
	if (!Number.isFinite(total) || total <= 0) return "`LIVE STREAM`";
	const safeCurrent = Math.max(0, Math.min(current, total));
	const filled = Math.min(size, Math.round((safeCurrent / total) * size));
	return `\`${"■".repeat(filled)}${"·".repeat(size - filled)}\` **${Math.round((safeCurrent / total) * 100)}%**`;
}

function requesterName(track: Track): string {
	const requester = track.requester as { username?: unknown; globalName?: unknown; displayName?: unknown } | undefined;
	const username = [requester?.username, requester?.globalName, requester?.displayName]
		.find((value) => typeof value === "string" && value.trim() && value !== "[object Object]");
	return escapeMarkdown(typeof username === "string" ? username : "Unknown user").slice(0, 80);
}

function sourceName(source: string): string {
	return source ? source.charAt(0).toUpperCase() + source.slice(1) : "Audio";
}

export function createMusicPanel(player: Player, track: Track, accentColor: number, fallbackArtwork?: string, recommendations: Track[] = []): ContainerBuilder {
	const duration = track.info.isStream ? "LIVE" : TimeFormat.toDotted(track.info.duration);
	const position = track.info.isStream ? "LIVE" : TimeFormat.toDotted(player.position);
	const title = escapeMarkdown(track.info.title).slice(0, 180);
	const _author = escapeMarkdown(track.info.author || "Unknown artist").slice(0, 100);
	const artwork = track.info.artworkUrl || fallbackArtwork || FALLBACK_ARTWORK;
	const repeat = player.repeatMode === "off" ? "Off" : player.repeatMode === "track" ? "Song" : "Queue";

	const details = new SectionBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### Now Playing\n**${title}** - ${sourceName(track.info.sourceName)}\n**Duration:** ${duration}\n**Requested by:** ${requesterName(track)}`,
			),
		)
		.setThumbnailAccessory(new ThumbnailBuilder().setURL(artwork).setDescription(`${track.info.title} artwork`));

	const status = new TextDisplayBuilder().setContent(
		`${progressBar(player.position, track.info.duration)}\n-# ${position} / ${duration}  |  Volume ${Math.round(player.volume)}%  |  Loop ${repeat}  |  Queue ${player.queue.tracks.length}`,
	);

	const primaryControls = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("music_resume")
			.setLabel(player.paused ? "Resume" : "Pause")
			.setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Primary),
		new ButtonBuilder().setCustomId("music_skip").setLabel("Skip").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId("music_stop").setLabel("Stop").setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId("music_loop")
			.setLabel(player.repeatMode === "off" ? "Loop" : `Loop: ${repeat}`)
			.setStyle(player.repeatMode === "off" ? ButtonStyle.Primary : ButtonStyle.Success),
	);

	const extraControls = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("music_shuffle")
			.setLabel("Shuffle")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(player.queue.tracks.length < 2),
		new ButtonBuilder().setCustomId("music_save").setLabel("Save").setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId("music_lyrics").setLabel("Lyrics").setStyle(ButtonStyle.Secondary),
	);
	const recommendationMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId("music_similar")
			.setPlaceholder("Add similar songs to queue...")
			.addOptions(
				recommendations.length
					? recommendations.map((item, index) => ({
						label: item.info.title.slice(0, 100),
						description: `${item.info.author || "Unknown artist"} - ${item.info.isStream ? "LIVE" : TimeFormat.toDotted(item.info.duration)}`.slice(0, 100),
						value: String(index),
					}))
					: [{ label: "Recommendations are loading", value: "none" }],
			)
			.setDisabled(recommendations.length === 0),
	);

	return new ContainerBuilder()
		.setAccentColor(accentColor)
		.addSectionComponents(details)
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(status)
		.addActionRowComponents(primaryControls, extraControls)
		.addActionRowComponents(recommendationMenu);
}

export function createQueueAddedPanel(track: Track, accentColor: number): ContainerBuilder {
	const title = escapeMarkdown(track.info.title).slice(0, 220);
	const author = escapeMarkdown(track.info.author || "Unknown artist").slice(0, 180);
	return new ContainerBuilder()
		.setAccentColor(accentColor)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent("### Added to Queue"))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}** by ${author}`));
}
