import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { VoiceCreator } from "@repo/db";

export default class Voicemaster extends Command {
	constructor() {
		super({
			name: "voicemaster",
			description: {
				content: "Begin VoiceMaster server configuration setup",
				examples: ["voicemaster setup", "voicemaster reset"],
				usage: "voicemaster setup",
			},
			category: "utils",
			aliases: ["vm", "vmaster"],
			cooldown: 5,
			args: true,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "ManageChannels"],
				user: ["ManageGuild"],
			},
			slashCommand: false,
			options: [
				{
					name: "setup",
					description: "Setup the voice channel",
					type: 1,
				},
				{
					name: "reset",
					description: "Reset the voice channel",
					type: 1,
				}
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand(true);

		if (subcommand === "setup") {
			const voiceCreator = await VoiceCreator.getByGuildId(ctx.guild.id!);
			if (voiceCreator) {
				return ctx.sendMessage("VoiceMaster is already configured.\nIf you want to reset it, use `voicemaster reset`");
			}

			const guild = ctx.guild;

			try {
				const category = await guild.channels.create({ name: "Private channels", type: ChannelType.GuildCategory });
				const voiceChannel = await guild.channels.create({
					name: "[+] Join to create",
					parent: category.id,
					type: ChannelType.GuildVoice,
					userLimit: 1,
					permissionOverwrites: [
						{
							id: guild.id,
							allow: [
								PermissionFlagsBits.ViewChannel,
								PermissionFlagsBits.Connect,
							],
							deny: [
								PermissionFlagsBits.MentionEveryone,
								PermissionFlagsBits.SendMessages,
								PermissionFlagsBits.ReadMessageHistory,
								PermissionFlagsBits.Speak,
							],
						},
					],
				});
				const textChannel = await guild.channels.create({
					name: "interface",
					type: ChannelType.GuildText,
					parent: category.id,
					permissionOverwrites: [
						{
							id: guild.id,
							deny: [
								PermissionFlagsBits.MentionEveryone,
								PermissionFlagsBits.SendMessages,
								PermissionFlagsBits.CreatePublicThreads,
								PermissionFlagsBits.CreatePrivateThreads,
								PermissionFlagsBits.ManageThreads,
							],
							allow: [
								PermissionFlagsBits.ViewChannel,
								PermissionFlagsBits.ReadMessageHistory,
							],
						},
					],
				});

				const LockButton = new ButtonBuilder().setCustomId("voice-lock").setLabel("🔒").setStyle(ButtonStyle.Secondary);
				const UnlockButton = new ButtonBuilder().setCustomId("voice-unlock").setLabel("🔓").setStyle(ButtonStyle.Secondary);
				const HideButton = new ButtonBuilder().setCustomId("voice-hide").setLabel("👁️").setStyle(ButtonStyle.Secondary);
				const UnhideButton = new ButtonBuilder().setCustomId("voice-unhide").setLabel("👀").setStyle(ButtonStyle.Secondary);
				const ViewButton = new ButtonBuilder().setCustomId("voice-view").setLabel("ℹ️").setStyle(ButtonStyle.Secondary);
				const DisconnectButton = new ButtonBuilder().setCustomId("voice-disconnect").setLabel("⏏️").setStyle(ButtonStyle.Secondary);
				const ClaimButton = new ButtonBuilder().setCustomId("voice-claim").setLabel("⭐").setStyle(ButtonStyle.Secondary);
				const ActivityButton = new ButtonBuilder().setCustomId("voice-activity").setLabel("🎮").setStyle(ButtonStyle.Secondary);
				const IncreaseLimitButton = new ButtonBuilder().setCustomId("voice-increase-limit").setLabel("➕").setStyle(ButtonStyle.Secondary);
				const DecreaseLimitButton = new ButtonBuilder().setCustomId("voice-decrease-limit").setLabel("➖").setStyle(ButtonStyle.Secondary);

				const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(LockButton, UnlockButton, HideButton, UnhideButton, ViewButton);
				const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(DisconnectButton, ClaimButton, ActivityButton, IncreaseLimitButton, DecreaseLimitButton);

				const vmContent = [
					`## ${guild.name}`,
					"Use the buttons below to control your voice channel.",
					"",
					"🔒 Lock · 🔓 Unlock · 👁️ Hide · 👀 Unhide · ℹ️ View",
					"⏏️ Disconnect · ⭐ Claim · 🎮 Activity · ➕ Increase · ➖ Decrease",
				].join("\n");

				await textChannel.send({ content: vmContent, components: [row1, row2] });

				await VoiceCreator.create(guild.id, {
					voiceChannelId: voiceChannel.id,
					textChannelId: textChannel.id,
					categoryId: category.id,
				});

				return ctx.sendMessage("✅ VoiceMaster setup complete. A category and two channels have been created — you can move or rename them.");
			} catch (e: any) {
				console.error("[VoiceMaster Setup Error]", e?.message ?? e, e?.stack ?? "");
				return ctx.sendMessage({
					content: `Failed to setup VoiceMaster: ${e?.message ?? "Unknown error"}`,
				});
			}
		}

		if (subcommand === "reset") {
			const voiceMaster = await VoiceCreator.getByGuildId(ctx.guild.id);
			if (!voiceMaster) {
				return ctx.sendMessage("There is no VoiceMaster setup in this server.");
			}

			await VoiceCreator.delete(ctx.guild.id, voiceMaster.categoryId);

			try {
				const category = await ctx.guild.channels.fetch(voiceMaster.categoryId).catch(() => null);
				const voiceChannel = await ctx.guild.channels.fetch(voiceMaster.voiceChannelId).catch(() => null);
				const textChannel = await ctx.guild.channels.fetch(voiceMaster.textChannelId).catch(() => null);

				await textChannel?.delete().catch(() => {});
				await voiceChannel?.delete().catch(() => {});
				await category?.delete().catch(() => {});
			} catch (e) {
				// Channels may already be deleted manually
			}

			return ctx.sendMessage("✅ VoiceMaster has been reset.");
		}
	}
}
