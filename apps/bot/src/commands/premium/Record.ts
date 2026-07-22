import { ApplicationCommandOptionType, EmbedBuilder, GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import { env } from "@repo/env";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { voiceRecordingService } from "../../service/voiceRecordingService";
import { buildRecordingPanel } from "../../utils/recordingControls";

export default class Record extends Command {
	constructor() {
		super({
			name: "record",
			description: {
				content: "Record a voice channel and receive a temporary MP3 by DM",
				examples: ["record start", "record status", "record stop", "record disconnect"],
				usage: "record <start|status|stop|disconnect>",
			},
			category: "premium",
			aliases: ["recording", "rec"],
			cooldown: 3,
			args: false,
			premium: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Connect"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "start",
					description: "Start a maximum five-minute recording",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "status",
					description: "Show the active recording status",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "stop",
					description: "Stop, mix, DM, and delete the temporary recording",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "disconnect",
					description: "Disconnect and discard an unfinished temporary recording",
					type: ApplicationCommandOptionType.Subcommand,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const requestedAction = ctx.options.getSubCommand(false, 0);
		if (!requestedAction) return ctx.sendMessage(buildRecordingPanel(ctx.client, ctx.guild.id));
		const action = requestedAction.toLowerCase();
		const status = voiceRecordingService.getStatus(ctx.guild.id);

		if (action === "disconnect") {
			if (!(ctx.member instanceof GuildMember) || !ctx.member.permissions.has(PermissionFlagsBits.Administrator)) {
				return ctx.sendMessage("You need the Administrator permission to disconnect the recorder.");
			}
			const disconnected = await voiceRecordingService.disconnect(ctx.guild.id);
			return ctx.sendMessage(
				disconnected
					? "Recorder disconnected. Any unfinished temporary recording was deleted without delivery."
					: "The recorder is not connected in this server.",
			);
		}

		if (action === "status") {
			if (!status) return ctx.sendMessage("There is no active voice recording in this server.");
			return ctx.sendMessage({
				embeds: [
					new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setTitle("Recording Active")
						.setDescription(`Channel: <#${status.channelId}>\nStarted: <t:${Math.floor(status.startedAt / 1_000)}:R>\nSpeakers captured: **${status.speakers}**`),
				],
			});
		}

		if (action === "start") {
			if (status) return ctx.sendMessage("A voice recording is already active in this server.");
			if (!(ctx.member instanceof GuildMember) || !ctx.member.voice.channel) {
				return ctx.sendMessage("Join the voice channel you want to record first.");
			}

			if (!ctx.member.permissions.has(PermissionFlagsBits.Administrator)) {
				return ctx.sendMessage("You need the Administrator permission to start a recording.");
			}

			const musicPlayer = ctx.client.manager.getPlayer(ctx.guild.id);
			if (musicPlayer?.connected) {
				return ctx.sendMessage("Disconnect the music player before recording (`leave`). Discord allows this bot one voice session per server.");
			}
			if (!ctx.member.voice.channel.permissionsFor(ctx.guild.members.me!)?.has(PermissionFlagsBits.Connect)) {
				return ctx.sendMessage("I need permission to connect to that voice channel.");
			}

			await ctx.author!.createDM();
			const started = await voiceRecordingService.start(ctx.guild, ctx.member.voice.channel, ctx.author!);
			return ctx.sendMessage({
				embeds: [
					new EmbedBuilder()
						.setColor(0xff3b30)
						.setTitle("Voice Recording Started")
						.setDescription(
							`Recording is active in <#${started.channelId}>. It stops after five minutes or with \`record stop\`. The MP3 will be sent only by DM, then all temporary bot files are deleted.`,
						),
				],
			});
		}

		if (action !== "stop") return ctx.sendMessage("Use `record start`, `record status`, `record stop`, or `record disconnect`.");
		if (!status) return ctx.sendMessage("There is no active voice recording in this server.");

		const isOwner = env.DEVELOPER_IDS.includes(ctx.author!.id);
		if (status.starterId !== ctx.author!.id && !isOwner) {
			return ctx.sendMessage({ content: "Only the user who started this recording or a bot owner can stop it.", flags: ctx.isInteraction ? MessageFlags.Ephemeral : undefined });
		}

		await ctx.sendDeferMessage("Finishing the recording and sending it by DM...");
		try {
			const result = await voiceRecordingService.finish(ctx.guild.id);
			const delivery = status.starterId === ctx.author!.id ? "your DMs" : `<@${status.starterId}>'s DMs`;
			return ctx.editMessage({
				content: `Recording complete: **${result.speakers}** speaker track(s), **${Math.ceil(result.durationMs / 1_000)} seconds**. The MP3 was sent to ${delivery} and all temporary files were deleted.`,
			});
		} catch (error) {
			ctx.client.logger.error("[record] Failed to finalize recording", error);
			return ctx.editMessage({ content: `Recording stopped, but delivery failed: ${error instanceof Error ? error.message : "unknown error"}. Temporary files were deleted.` });
		}
	}
}
