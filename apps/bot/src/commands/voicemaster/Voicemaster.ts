import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "discord.js";
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
			const guild = ctx.guild;
			const existingCreator = await VoiceCreator.getByGuildId(guild.id!);

			if (existingCreator) {
				// Validate the existing setup — check if channels still exist
				const voiceChannel = await guild.channels.fetch(existingCreator.voiceChannelId).catch(() => null);
				const categoryChannel = await guild.channels.fetch(existingCreator.categoryId).catch(() => null);

				if (voiceChannel && categoryChannel) {
					// Existing setup is still valid
					return ctx.sendMessage("VoiceMaster is already configured.\nIf you want to reset it, use `voicemaster reset`");
				}

				// Stale record — channels were deleted manually. Clean up and re-create.
				await VoiceCreator.delete(guild.id, existingCreator.categoryId);
				// Also try to clean up any remaining channels from old setup
				const oldText = await guild.channels.fetch(existingCreator.textChannelId).catch(() => null);
				await oldText?.delete().catch(() => {});
				await voiceChannel?.delete().catch(() => {});
				await categoryChannel?.delete().catch(() => {});
			}

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

				const LockButton = new ButtonBuilder().setCustomId("voice-lock").setEmoji("1532994741594099784").setStyle(ButtonStyle.Secondary);
				const UnlockButton = new ButtonBuilder().setCustomId("voice-unlock").setEmoji("1532994676230193252").setStyle(ButtonStyle.Secondary);
				const HideButton = new ButtonBuilder().setCustomId("voice-hide").setEmoji("1532994897638854827").setStyle(ButtonStyle.Secondary);
				const UnhideButton = new ButtonBuilder().setCustomId("voice-unhide").setEmoji("1532995043688976567").setStyle(ButtonStyle.Secondary);
				const ViewButton = new ButtonBuilder().setCustomId("voice-view").setEmoji("1532995283867402280").setStyle(ButtonStyle.Secondary);
				const DisconnectButton = new ButtonBuilder().setCustomId("voice-disconnect").setEmoji("1532995923829850172").setStyle(ButtonStyle.Secondary);
				const ClaimButton = new ButtonBuilder().setCustomId("voice-claim").setEmoji("1532996165786669096").setStyle(ButtonStyle.Secondary);
				const ActivityButton = new ButtonBuilder().setCustomId("voice-activity").setEmoji("1532997243768930304").setStyle(ButtonStyle.Secondary);
				const IncreaseLimitButton = new ButtonBuilder().setCustomId("voice-increase-limit").setEmoji("1532997686041514127").setStyle(ButtonStyle.Secondary);
				const DecreaseLimitButton = new ButtonBuilder().setCustomId("voice-decrease-limit").setEmoji("1532997616550412390").setStyle(ButtonStyle.Secondary);
				const MuteButton = new ButtonBuilder().setCustomId("voice-mute").setEmoji("1533000723585826816").setStyle(ButtonStyle.Secondary);
				const UnmuteButton = new ButtonBuilder().setCustomId("voice-unmute").setEmoji("1533000700500381779").setStyle(ButtonStyle.Secondary);

				const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(LockButton, UnlockButton, HideButton, UnhideButton);
				const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(ViewButton, DisconnectButton, ClaimButton, ActivityButton);
				const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(IncreaseLimitButton, DecreaseLimitButton, MuteButton, UnmuteButton);

				const controlGuide = [
					"<:lock:1532994741594099784> `Lock` — Prevent members from joining.",
					"<:unlock:1532994676230193252> `Unlock` — Allow members to join.",
					"<:visibilityoff:1532994897638854827> `Hide` — Hide the channel from members.",
					"<:visibility:1532995043688976567> `Unhide` — Make the channel visible.",
					"<:info:1532995283867402280> `Info` — View channel information.",
					"<:disconnect:1532995923829850172> `Disconnect` — Remove a member from the channel.",
					"<:claim:1532996165786669096> `Claim` — Claim an ownerless channel.",
					"<:activity:1532997243768930304> `Activity` — Start a voice channel activity.",
					"<:add:1532997686041514127> `Increase` — Raise the channel user limit.",
					"<:remove:1532997616550412390> `Decrease` — Lower the channel user limit.",
					"<:mic_off:1533000723585826816> `Mute` — Mute a member in the channel.",
					"<:mic_on:1533000700500381779> `Unmute` — Unmute a member in the channel.",
				].join("\n");

				const container = new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent("## VoiceMaster Interface"))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent("Use the buttons below to manage your temporary voice channel."))
					.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(`__**Control Buttons**__\n${controlGuide}`))
					.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
					.addActionRowComponents(row1, row2, row3)
					.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Powered by Elfaria"));

				await textChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

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
