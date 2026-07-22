import { ApplicationCommandOptionType, ChannelType, GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import { Premium } from "@repo/db";
import { env } from "@repo/env";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

import AlwaysOn from "./247";
import Autoplay from "./Autoplay";
import ClearQueue from "./ClearQueue";
import Join from "./Join";
import Leave from "./Leave";
import Loop from "./Loop";
import Nowplaying from "./Nowplaying";
import Pause from "./Pause";
import Play from "./Play";
import PlayFile from "./PlayFile";
import Queue from "./Queue";
import Remove from "./Remove";
import Replay from "./Replay";
import Resume from "./Resume";
import Search from "./Search";
import Seek from "./Seek";
import Shuffle from "./Shuffle";
import Skip from "./Skip";
import Skipto from "./Skipto";
import Stop from "./Stop";
import Volume from "./Volume";

const handlers = {
	"always-on": new AlwaysOn(),
	autoplay: new Autoplay(),
	"clear-queue": new ClearQueue(),
	join: new Join(),
	leave: new Leave(),
	loop: new Loop(),
	"now-playing": new Nowplaying(),
	pause: new Pause(),
	play: new Play(),
	"play-file": new PlayFile(),
	queue: new Queue(),
	remove: new Remove(),
	replay: new Replay(),
	resume: new Resume(),
	search: new Search(),
	seek: new Seek(),
	shuffle: new Shuffle(),
	skip: new Skip(),
	"skip-to": new Skipto(),
	stop: new Stop(),
	volume: new Volume(),
} as const;

export default class Music extends Command {
	public constructor() {
		super({
			name: "music",
			description: { content: "Play and manage music", examples: ["music play query:Humsafar", "music queue"], usage: "music <action>" },
			category: "music",
			cooldown: 2,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Connect", "Speak"], user: [] },
			options: [
				{ name: "play", description: "Play a song by name or URL", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "query", description: "Song name or URL", type: ApplicationCommandOptionType.String, required: true, autocomplete: true }] },
				{ name: "play-file", description: "Play an uploaded audio file", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "file", description: "Audio file to play", type: ApplicationCommandOptionType.Attachment, required: true }] },
				{ name: "pause", description: "Pause the current track", type: ApplicationCommandOptionType.Subcommand },
				{ name: "resume", description: "Resume playback", type: ApplicationCommandOptionType.Subcommand },
				{ name: "stop", description: "Stop playback and clear the queue", type: ApplicationCommandOptionType.Subcommand },
				{ name: "skip", description: "Skip the current track", type: ApplicationCommandOptionType.Subcommand },
				{ name: "skip-to", description: "Skip to a queue position", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "number", description: "Queue position", type: ApplicationCommandOptionType.Integer, required: true }] },
				{ name: "replay", description: "Replay the current track", type: ApplicationCommandOptionType.Subcommand },
				{ name: "queue", description: "Show the queue", type: ApplicationCommandOptionType.Subcommand },
				{ name: "remove", description: "Remove a queue item", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "song", description: "Queue position", type: ApplicationCommandOptionType.Integer, required: true }] },
				{ name: "clear-queue", description: "Clear queued tracks", type: ApplicationCommandOptionType.Subcommand },
				{ name: "shuffle", description: "Shuffle the queue", type: ApplicationCommandOptionType.Subcommand },
				{ name: "loop", description: "Set loop mode", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "mode", description: "Loop mode", type: ApplicationCommandOptionType.String, required: false, choices: [{ name: "Off", value: "off" }, { name: "Song", value: "song" }, { name: "Queue", value: "queue" }] }] },
				{ name: "seek", description: "Seek in the current track", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "duration", description: "Example: 1m 30s", type: ApplicationCommandOptionType.String, required: true }] },
				{ name: "volume", description: "Set volume", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "number", description: "Volume 0-200", type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 200 }] },
				{ name: "search", description: "Search for a song", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "song", description: "Song to search for", type: ApplicationCommandOptionType.String, required: true }] },
				{ name: "join", description: "Join your voice channel", type: ApplicationCommandOptionType.Subcommand },
				{ name: "leave", description: "Leave the voice channel", type: ApplicationCommandOptionType.Subcommand },
				{ name: "now-playing", description: "Show the current track", type: ApplicationCommandOptionType.Subcommand },
				{ name: "autoplay", description: "Toggle premium autoplay", type: ApplicationCommandOptionType.Subcommand },
				{ name: "always-on", description: "Toggle premium 24/7 mode", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const action = ctx.options.getSubCommand(true, 0) as keyof typeof handlers;
		const handler = handlers[action];
		if (!handler) return ctx.sendMessage({ content: "That music action is not available.", allowedMentions: { parse: [] } });

		const premiumAction = action === "play-file" || action === "autoplay" || action === "always-on";
		const activeAction = !["play", "play-file", "search", "join", "leave", "always-on"].includes(action);
		if (premiumAction && !env.DEVELOPER_IDS.includes(ctx.author!.id) && !(await Premium.hasPremium(ctx.author!.id))) {
			return ctx.sendMessage({ content: "This is a premium music action. Use `/premium redeem` with an activation code to unlock it.", flags: ctx.isInteraction ? MessageFlags.Ephemeral : undefined });
		}
		if (!(ctx.member instanceof GuildMember) || !ctx.member.voice.channel) return ctx.sendMessage("You need to be in a voice channel to use music.");
		const clientMember = ctx.guild.members.resolve(ctx.client.user!)!;
		if (!clientMember.permissions.has(PermissionFlagsBits.Connect) || !clientMember.permissions.has(PermissionFlagsBits.Speak)) {
			return ctx.sendMessage("I need Connect and Speak permissions for music.");
		}
		if (ctx.member.voice.channel.type === ChannelType.GuildStageVoice && !clientMember.permissions.has(PermissionFlagsBits.RequestToSpeak)) {
			return ctx.sendMessage("I need Request to Speak permission in stage channels.");
		}
		const player = ctx.client.manager.getPlayer(ctx.guild.id);
		const activeVoiceChannelId = clientMember.voice.channelId ?? (player?.connected ? player.voiceChannelId : null);
		if (activeVoiceChannelId && activeVoiceChannelId !== ctx.member.voice.channelId) {
			return ctx.sendMessage({ content: `I am already being used in <#${activeVoiceChannelId}>. Join that voice channel to use music commands.`, allowedMentions: { parse: [] } });
		}
		if (activeAction && !player?.queue.current) return ctx.sendMessage("There is no song currently playing.");
		return handler.run(ctx, ctx.args);
	}
}
