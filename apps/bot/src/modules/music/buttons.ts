import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, GuildMember, MessageFlags, StringSelectMenuInteraction } from "discord.js";
import type { Player, Track } from "lavalink-client";
import BaseClient from "../../base/Client";
import { Premium } from "@repo/db";
import { env } from "@repo/env";
import { acquireMusicCommandLock } from "../../utils/musicCommandSafety";
import { createMusicPanel } from "../../utils/musicPanel";
import { readMusicRecommendations } from "../../utils/musicRecommendations";

const MUSIC_BUTTONS = new Set([
	"music_resume",
	"music_skip",
	"music_stop",
	"music_loop",
	"music_shuffle",
	"music_save",
	"music_lyrics",
	"music_similar",
]);

export class MusicModule {
	private readonly client: BaseClient;

	public constructor(private readonly interaction: ButtonInteraction | StringSelectMenuInteraction) {
		this.client = interaction.client as BaseClient;
	}

	public async handle(): Promise<void> {
		const { customId } = this.interaction;
		if (!MUSIC_BUTTONS.has(customId) || !this.interaction.guildId) return;

		const player = this.client.manager.getPlayer(this.interaction.guildId);
		if (!player || !player.queue.current) return this.reply("Nothing is playing right now.");

		const member = this.interaction.member as GuildMember;
		if (!member?.voice?.channelId) return this.reply("Join my voice channel to use the music controls.");
		if (member.voice.channelId !== player.voiceChannelId) return this.reply(`Music is currently being used in <#${player.voiceChannelId}>.`);

		if (customId === "music_save") return this.saveTrack(player.queue.current);
		if (customId === "music_lyrics") return this.showLyricsLink(player.queue.current);

		const release = await acquireMusicCommandLock(this.client.redis, this.interaction.guildId, this.interaction.id);
		if (!release) return this.reply("Another music control is being processed. Try again in a moment.");

		try {
			switch (customId) {
				case "music_resume":
					await this.interaction.deferUpdate();
					player.paused ? await player.resume() : await player.pause();
					await this.updatePanel(player);
					break;
				case "music_skip":
					await this.interaction.deferUpdate();
					await player.skip();
					break;
				case "music_stop":
					await this.interaction.deferUpdate();
					await player.stopPlaying(true, false);
					break;
				case "music_loop": {
					await this.interaction.deferUpdate();
					const nextMode = player.repeatMode === "off" ? "track" : player.repeatMode === "track" ? "queue" : "off";
					await player.setRepeatMode(nextMode);
					await this.updatePanel(player);
					break;
				}
				case "music_shuffle":
					if (player.queue.tracks.length < 2) return this.reply("Add at least two queued songs before shuffling.");
					await this.interaction.deferUpdate();
					player.queue.shuffle();
					await this.updatePanel(player);
					break;
				case "music_similar": {
					const isDeveloper = env.DEVELOPER_IDS.includes(this.interaction.user.id);
					if (!isDeveloper && !(await Premium.hasPremium(this.interaction.user.id))) {
						return this.reply("Adding similar songs requires premium access. Use /premium redeem to activate it.");
					}
					if (!this.interaction.isStringSelectMenu()) return;
					await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
					const recommendations = await readMusicRecommendations(this.client.redis, player, player.queue.current);
					const selected = recommendations[Number(this.interaction.values[0])];
					if (!selected) {
						await this.interaction.editReply("-# That recommendation expired. Run /nowplaying to refresh the list.");
						break;
					}
					await player.queue.add(selected);
					await this.updatePanel(player);
					await this.interaction.editReply(`-# Added **${selected.info.title}** to the queue.`);
					break;
				}
			}
		} catch (error) {
			this.client.logger.error(`Music button ${customId} failed: ${error instanceof Error ? error.message : String(error)}`);
			if (!this.interaction.deferred && !this.interaction.replied) await this.reply("That control could not be completed. Please try again.");
		} finally {
			await release();
		}
	}

	private async updatePanel(player: Player): Promise<void> {
		const track = player.queue.current;
		if (!track) return;
		const recommendations = await readMusicRecommendations(this.client.redis, player, track);
		await this.interaction.message.edit({
			components: [createMusicPanel(player, track, this.client.config.colors.main, this.client.user?.displayAvatarURL(), recommendations)],
		});
	}

	private async saveTrack(track: Track): Promise<void> {
		try {
			await this.interaction.user.send(
				`### Saved track\n[**${track.info.title}**](${track.info.uri})\n-# ${track.info.author} • Saved from ${this.interaction.guild?.name || "Discord"}`,
			);
			await this.reply("I sent the current track to your DMs.");
		} catch {
			await this.reply("I could not DM you. Enable direct messages for this server and try again.");
		}
	}

	private async showLyricsLink(track: Track): Promise<void> {
		const query = encodeURIComponent(`${track.info.title} ${track.info.author}`);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel("Search lyrics").setStyle(ButtonStyle.Link).setURL(`https://genius.com/search?q=${query}`),
		);
		await this.interaction.reply({ content: `-# Lyrics search for **${track.info.title}**`, components: [row], flags: MessageFlags.Ephemeral });
	}

	private async reply(message: string): Promise<void> {
		await this.interaction.reply({ content: `-# ${message}`, flags: MessageFlags.Ephemeral });
	}
}
