import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
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
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
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
				return ctx.sendMessage({
					embeds: [
						new EmbedBuilder()
							.setDescription("VoiceMaster is already configured\nIf you want to reset it, use `/voicemaster reset`")
							.setColor("Red"),
					],
				});
			}
			const guild = ctx.guild;
			const category = await guild.channels.create({ name: "Private channels", type: ChannelType.GuildCategory });
			const voiceChannel = await guild.channels.create({
				name: "[+] Join to create", parent: category.id, type: ChannelType.GuildVoice, userLimit: 1,
				permissionOverwrites: [
					{
						id: guild.id,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.Connect,
							PermissionFlagsBits.CreatePublicThreads,
							PermissionFlagsBits.CreatePrivateThreads,
							PermissionFlagsBits.ManageThreads,
						],
						deny: [
							PermissionFlagsBits.MentionEveryone,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.ReadMessageHistory,
							PermissionFlagsBits.Speak
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
			const embed = new EmbedBuilder()
				.setDescription(
					"Use the button below to toggle your voice channel settings.\n\n**Button Usage**\n\n<:lock_200dp_E3E3E3_FILL1_wght400_:1367045380637851678> : Lock \n<:lock_open_right_200dp_E3E3E3_FIL:1367045358752108574> : Unlock\n<:visibility_off_200dp_E3E3E3_FILL:1367045335528247366> : Unhide\n<:visibility_200dp_E3E3E3_FILL1_wg:1367045307157970975> : Hide\n<:info_200dp_E3E3E3_FILL1_wght700_:1367045440041648270> : View\n<:power_off_200dp_E3E3E3_FILL1_wgh:1367048142989688872> : Disconnect\n<:star_rate_half_200dp_E3E3E3_FILL:1367050545277308950> : Claim\n<:stadia_controller_200dp_E3E3E3_F:1367047003858796585> : Activity\n<:person_add_200dp_E3E3E3_FILL1_wg:1367045257656668180> : Increase Limit \n<:person_remove_200dp_E3E3E3_FILL1:1367045281979564054> : Decrease Limit",
				)
				.setAuthor({ name: guild.name, iconURL: guild.iconURL()! })
				.setColor(ctx.client.config.colors.main)
				.setTimestamp();

			const LockButton = new ButtonBuilder().setCustomId("voice-lock").setEmoji("<:lock_200dp_E3E3E3_FILL1_wght400_:1367045380637851678>").setStyle(ButtonStyle.Secondary);
			const UnlockButton = new ButtonBuilder().setCustomId("voice-unlock").setEmoji("<:lock_open_right_200dp_E3E3E3_FIL:1367045358752108574>").setStyle(ButtonStyle.Secondary);
			const UnhideButton = new ButtonBuilder().setCustomId("voice-unhide").setEmoji("<:visibility_off_200dp_E3E3E3_FILL:1367045335528247366>").setStyle(ButtonStyle.Secondary);
			const HideButton = new ButtonBuilder().setCustomId("voice-hide").setEmoji("<:visibility_200dp_E3E3E3_FILL1_wg:1367045307157970975>").setStyle(ButtonStyle.Secondary);
			const ViewButton = new ButtonBuilder().setCustomId("voice-view").setEmoji("<:info_200dp_E3E3E3_FILL1_wght700_:1367045440041648270>").setStyle(ButtonStyle.Secondary);
			const DisconnectButton = new ButtonBuilder().setCustomId("voice-disconnect").setEmoji("<:power_off_200dp_E3E3E3_FILL1_wgh:1367048142989688872>").setStyle(ButtonStyle.Secondary);
			const ClaimButton = new ButtonBuilder().setCustomId("voice-claim").setEmoji("<:star_rate_half_200dp_E3E3E3_FILL:1367050545277308950>").setStyle(ButtonStyle.Secondary);
			const ActivityButton = new ButtonBuilder().setCustomId("voice-activity").setEmoji("<:stadia_controller_200dp_E3E3E3_F:1367047003858796585>").setStyle(ButtonStyle.Secondary);
			const IncreaseLimitButton = new ButtonBuilder().setCustomId("voice-increase-limit").setEmoji("<:person_add_200dp_E3E3E3_FILL1_wg:1367045257656668180>").setStyle(ButtonStyle.Secondary);
			const DecreaseLimitButton = new ButtonBuilder().setCustomId("voice-decrease-limit").setEmoji("<:person_remove_200dp_E3E3E3_FILL1:1367045281979564054>").setStyle(ButtonStyle.Secondary);

			const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(LockButton, UnlockButton, UnhideButton, HideButton, ViewButton);
			const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(DisconnectButton, ClaimButton, ActivityButton, IncreaseLimitButton, DecreaseLimitButton);
			await textChannel.send({ embeds: [embed], components: [row1, row2] });
			await VoiceCreator.update(guild.id, category.id, {
				voiceChannelId: voiceChannel.id,
				textChannelId: textChannel.id,
				categoryId: category.id,
			});
			return ctx.editOrReply({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: ctx.author?.username!, iconURL: ctx.author?.displayAvatarURL() })
						.setDescription("Finished setting up the VoiceMaster channels. A category and two channels have been created, you can move the channels or rename them if you want.")
						.setColor(ctx.client.config.colors.main),
				],
			});
		}
		if (subcommand === "reset") {
			const voiceMaster = await VoiceCreator.getByGuildId(ctx.guild.id);
			if (!voiceMaster) return ctx.editOrReply({ embeds: [new EmbedBuilder().setDescription("There is no VoiceMaster setup in this server.").setColor(ctx.client.config.colors.red)] });
			await VoiceCreator.delete(ctx.guild.id, voiceMaster.categoryId);
			try {
				const category = await ctx.guild.channels.fetch(voiceMaster.categoryId);
				const voiceChannel = await ctx.guild.channels.fetch(voiceMaster.voiceChannelId);
				const textChannel = await ctx.guild.channels.fetch(voiceMaster.textChannelId);
				
				await category?.delete().catch(() => { });
				await voiceChannel?.delete().catch(() => { });
				await textChannel?.delete().catch(() => { });
			} catch (e) { }

			return ctx.editOrReply({ embeds: [new EmbedBuilder().setDescription("VoiceMaster has been reset.").setColor(ctx.client.config.colors.main)] });
		}
	}
}
