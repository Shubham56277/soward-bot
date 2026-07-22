import { Premium } from "@repo/db";
import { env } from "@repo/env";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	EmbedBuilder,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
} from "discord.js";
import BaseClient from "../base/Client";
import { voiceRecordingService } from "../service/voiceRecordingService";

export function buildRecordingPanel(client: BaseClient, guildId: string) {
	const status = voiceRecordingService.getStatus(guildId);
	const prefix = client.config.prefix;
	const embed = new EmbedBuilder()
		.setColor(status ? 0xff3b30 : client.config.colors.main)
		.setAuthor({ name: "Soward Premium" })
		.setTitle(status ? "Voice Recording Control - Active" : "Voice Recording Control")
		.setDescription(
			status
				? `A recording is active in <#${status.channelId}>. It started <t:${Math.floor(status.startedAt / 1_000)}:R> and has captured **${status.speakers}** speaker track(s).`
				: "Record everyone speaking in your current voice channel and receive one mixed MP3 privately by DM.",
		)
		.addFields(
			{
				name: "Commands",
				value: `\`${prefix}record start\` - start\n\`${prefix}record status\` - view status\n\`${prefix}record stop\` - finish and receive MP3\n\`${prefix}record disconnect\` - disconnect and discard`,
			},
			{
				name: "Privacy & limits",
				value: "Premium + Administrator only • A public notice is posted • Maximum 5 minutes • Music must be disconnected • Temporary files are deleted after DM delivery",
			},
		)
		.setFooter({ text: "Use the buttons below or the listed commands" })
		.setTimestamp();

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("recording-start").setLabel("Start").setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId("recording-status").setLabel("Status").setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId("recording-stop").setLabel("Stop").setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId("recording-disconnect").setLabel("Disconnect").setStyle(ButtonStyle.Secondary),
	);

	return { embeds: [embed], components: [row] };
}

export async function requireRecordingPremium(interaction: ButtonInteraction): Promise<boolean> {
	if (env.DEVELOPER_IDS.includes(interaction.user.id) || (await Premium.hasPremium(interaction.user.id))) return true;
	await interaction.reply({
		content: "This is a premium feature. Redeem an activation code with `/premium redeem` first.",
		flags: MessageFlags.Ephemeral,
	});
	return false;
}

export async function startRecordingFromButton(interaction: ButtonInteraction) {
	if (!interaction.inCachedGuild() || !(interaction.member instanceof GuildMember)) return;
	if (!(await requireRecordingPremium(interaction))) return;
	if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
		return interaction.reply({ content: "You need the Administrator permission to start a recording.", flags: MessageFlags.Ephemeral });
	}
	if (voiceRecordingService.getStatus(interaction.guildId)) {
		return interaction.reply({ content: "A voice recording is already active in this server.", flags: MessageFlags.Ephemeral });
	}
	const client = interaction.client as BaseClient;
	const channel = interaction.member.voice.channel;
	if (!channel) return interaction.reply({ content: "Join the voice channel you want to record first.", flags: MessageFlags.Ephemeral });
	if (client.manager.getPlayer(interaction.guildId)?.connected) {
		return interaction.reply({ content: "Disconnect the music player with `/leave` before recording.", flags: MessageFlags.Ephemeral });
	}
	if (!channel.permissionsFor(interaction.guild.members.me!)?.has(PermissionFlagsBits.Connect)) {
		return interaction.reply({ content: "I need permission to connect to that voice channel.", flags: MessageFlags.Ephemeral });
	}

	await interaction.deferReply();
	try {
		await interaction.user.createDM();
		const started = await voiceRecordingService.start(interaction.guild, channel, interaction.user);
		return interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setColor(0xff3b30)
					.setTitle("Voice Recording Started")
					.setDescription(
						`Recording is active in <#${started.channelId}>. It stops after five minutes or with \`/record stop\`. The MP3 will be sent only to <@${started.starterId}>, then all temporary files are deleted.`,
					)
					.setTimestamp(),
			],
			components: [],
		});
	} catch (error) {
		return interaction.editReply({ content: `Could not start recording: ${error instanceof Error ? error.message : "unknown error"}.`, components: [] });
	}
}

export async function stopRecordingFromButton(interaction: ButtonInteraction) {
	if (!interaction.inCachedGuild()) return;
	if (!(await requireRecordingPremium(interaction))) return;
	const status = voiceRecordingService.getStatus(interaction.guildId);
	if (!status) return interaction.reply({ content: "There is no active voice recording in this server.", flags: MessageFlags.Ephemeral });
	const isOwner = env.DEVELOPER_IDS.includes(interaction.user.id);
	if (status.starterId !== interaction.user.id && !isOwner) {
		return interaction.reply({ content: "Only the user who started this recording or a bot owner can stop it.", flags: MessageFlags.Ephemeral });
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const result = await voiceRecordingService.finish(interaction.guildId);
		const delivery = status.starterId === interaction.user.id ? "your DMs" : `<@${status.starterId}>'s DMs`;
		return interaction.editReply(
			`Recording complete: **${result.speakers}** speaker track(s), **${Math.ceil(result.durationMs / 1_000)} seconds**. The MP3 was sent to ${delivery} and all temporary files were deleted.`,
		);
	} catch (error) {
		return interaction.editReply(`Recording stopped, but delivery failed: ${error instanceof Error ? error.message : "unknown error"}. Temporary files were deleted.`);
	}
}
