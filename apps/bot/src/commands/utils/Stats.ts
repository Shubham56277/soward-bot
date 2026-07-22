import os from "node:os";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
	version as discordJsVersion,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { compactReplyText } from "../../utils/compactReply";
import { formatBytes, TimeFormat } from "../../utils/timeFormat";

const STATS_TIMEOUT_MS = 5 * 60_000;

interface BotTotals {
	guilds: number;
	members: number;
	channels: number;
	players: number;
}

interface SystemSnapshot {
	os: string;
	hostUptime: string;
	cpu: string;
	cpuUsage: string;
	processMemory: string;
	totalMemory: string;
	freeMemory: string;
	heapUsed: string;
	processUptime: string;
}

type StatsView = "bot" | "system";

export default class Stats extends Command {
	public constructor() {
		super({
			name: "stats",
			description: { content: "Displays the bot's stats.", examples: ["stats"], usage: "stats" },
			category: "utils",
			aliases: ["status", "botstatus", "botstats"],
			cooldown: 5,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		await ctx.sendDeferMessage("-# Gathering live statistics...");
		const [totals, system] = await Promise.all([this.collectTotals(ctx), this.collectSystemSnapshot()]);
		let view: StatsView = "bot";
		const render = (disabled = false) => ({ components: [this.statsContainer(ctx, totals, system, view, disabled)] });
		const response = await ctx.editMessage({ content: "", embeds: [], ...render(), flags: MessageFlags.IsComponentsV2 });
		const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : response;
		const collector = message.createMessageComponentCollector({ time: STATS_TIMEOUT_MS });

		collector.on("collect", async (interaction) => {
			if (!interaction.isButton() || !["stats_bot", "stats_system"].includes(interaction.customId)) return;
			if (interaction.user.id !== ctx.author?.id) {
				await interaction.reply({ content: compactReplyText("Only the person who opened this panel can change its view."), flags: MessageFlags.Ephemeral }).catch(() => undefined);
				return;
			}
			view = interaction.customId === "stats_system" ? "system" : "bot";
			await interaction.update(render()).catch((error) => ctx.client.logger.error("[stats] View update failed", error));
		});

		collector.on("end", async () => {
			if (message.editable) await message.edit(render(true)).catch(() => undefined);
		});
		return message;
	}

	private async collectTotals(ctx: Context): Promise<BotTotals> {
		try {
			const results = await ctx.client.cluster.broadcastEval((client) => ({
				guilds: client.guilds.cache.size,
				members: client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0),
				channels: client.channels.cache.size,
				players: (client as any).manager?.players?.size ?? 0,
			}));
			return results.reduce<BotTotals>(
				(totals, current) => ({
					guilds: totals.guilds + current.guilds,
					members: totals.members + current.members,
					channels: totals.channels + current.channels,
					players: totals.players + current.players,
				}),
				{ guilds: 0, members: 0, channels: 0, players: 0 },
			);
		} catch {
			return {
				guilds: ctx.client.guilds.cache.size,
				members: ctx.client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0),
				channels: ctx.client.channels.cache.size,
				players: ctx.client.manager.players.size,
			};
		}
	}

	private async collectSystemSnapshot(): Promise<SystemSnapshot> {
		const startUsage = process.cpuUsage();
		const startTime = process.hrtime.bigint();
		await new Promise((resolve) => setTimeout(resolve, 150));
		const usage = process.cpuUsage(startUsage);
		const elapsedMicros = Number(process.hrtime.bigint() - startTime) / 1_000;
		const coreCount = Math.max(1, os.cpus().length);
		const cpuPercent = Math.min(100, ((usage.user + usage.system) / elapsedMicros / coreCount) * 100);
		const memory = process.memoryUsage();
		return {
			os: `${os.type()} ${os.release()}`,
			hostUptime: TimeFormat.toHumanize(Math.floor(os.uptime() * 1000)),
			cpu: `${os.arch()} (${coreCount} cores)`,
			cpuUsage: `${cpuPercent.toFixed(2)}%`,
			processMemory: formatBytes(memory.rss),
			totalMemory: formatBytes(os.totalmem()),
			freeMemory: formatBytes(os.freemem()),
			heapUsed: formatBytes(memory.heapUsed),
			processUptime: TimeFormat.toHumanize(Math.floor(process.uptime() * 1000)),
		};
	}

	private statsContainer(ctx: Context, totals: BotTotals, system: SystemSnapshot, view: StatsView, disabled: boolean): ContainerBuilder {
		const client = ctx.client;
		const botName = client.user?.username || "Soward";
		const avatar = client.user?.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png";
		const heading = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## ${botName} Statistics\n-# Live network and runtime information.`),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${botName} profile picture`));
		const container = new ContainerBuilder()
			.setAccentColor(client.config.colors.main)
			.addSectionComponents(heading)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

		if (view === "bot") {
			const nodes = [...client.manager.nodeManager.nodes.values()];
			const lavalink = nodes.some((node) => node.connected) ? "Connected" : "Disconnected";
			const cluster = client.cluster.info;
			container
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**System**\n-# **OS** — ${system.os}\n-# **Uptime** — ${system.hostUptime}\n-# **CPU** — ${system.cpu} · **Usage** ${system.cpuUsage}\n-# **Memory** — ${system.processMemory} / ${system.totalMemory} · **Free** ${system.freeMemory}`,
					),
				)
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**Software**\n-# **Node.js** — ${process.version} · **Discord.js** v${discordJsVersion}\n-# **Commands Loaded** — ${client.commands.size.toLocaleString()}`,
					),
				)
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**Bot Stats**\n-# **Guilds** ${totals.guilds.toLocaleString()} · **Users** ${totals.members.toLocaleString()} · **Channels** ${totals.channels.toLocaleString()}\n-# **Active Players** ${totals.players.toLocaleString()} · **Lavalink** ${lavalink}\n-# **Uptime** ${TimeFormat.toHumanize(client.uptime || 0)}\n-# **Shard** ${ctx.guild.shardId + 1}/${cluster.TOTAL_SHARDS} · **API Latency** ${Math.round(client.ws.ping)}ms\n\n**Sharding**\n-# **Total Shards** ${cluster.TOTAL_SHARDS} · **Cluster** ${cluster.CLUSTER + 1}/${cluster.CLUSTER_COUNT}\n-# **Cluster Shards** [${cluster.SHARD_LIST.join(", ")}] · **This Server** Shard ${ctx.guild.shardId}`,
					),
				);
		} else {
			const cpu = os.cpus()[0];
			container
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**Runtime**\n-# **OS** — ${system.os} · **Architecture** ${os.arch()}\n-# **Node.js** ${process.version} · **Discord.js** v${discordJsVersion}\n-# **Process Uptime** ${system.processUptime} · **Host Uptime** ${system.hostUptime}`,
					),
				)
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**Resources**\n-# **CPU** — ${cpu?.model || "Unknown"}\n-# **Cores** ${os.cpus().length} · **Usage** ${system.cpuUsage}\n-# **Process Memory** ${system.processMemory} · **Heap** ${system.heapUsed}\n-# **Host Memory** ${formatBytes(os.totalmem() - os.freemem())} / ${system.totalMemory} · **Free** ${system.freeMemory}\n-# **Cluster Mode** ${client.cluster.info.CLUSTER_MANAGER_MODE} · **Lavalink Nodes** ${client.manager.nodeManager.nodes.size}`,
					),
				);
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addActionRowComponents(this.linkRow(ctx));
		container.addActionRowComponents(this.tabRow(view, disabled));
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# Requested by ${ctx.author?.username ?? "Unknown user"} · Powered by ${botName} · <t:${Math.floor(Date.now() / 1_000)}:t>`,
			),
		);
		return container;
	}

	private linkRow(ctx: Context): ActionRowBuilder<ButtonBuilder> {
		const botId = ctx.client.user?.id || "1013771497157972008";
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel("Invite Me").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.invite),
			new ButtonBuilder().setLabel("Support Server").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.supportServer),
			new ButtonBuilder().setLabel("Vote").setStyle(ButtonStyle.Link).setURL(`https://top.gg/bot/${botId}/vote`),
		);
	}

	private tabRow(view: StatsView, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("stats_bot").setLabel("Bot Info").setStyle(view === "bot" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("stats_system").setLabel("System Info").setStyle(view === "system" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
		);
	}
}
