import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { env } from "@repo/env";

export default class Nodes extends Command {
	constructor() {
		super({
			name: "nodes",
			description: { content: "Show system node status (AI, Lavalink, Shards)", examples: ["nodes"], usage: "nodes" },
			category: "dev",
			aliases: ["aistatus", "status"],
			cooldown: 5,
			args: false,
			permissions: { dev: true, client: ["SendMessages", "ViewChannel"], user: [] },
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!env.DEVELOPER_IDS.includes(ctx.author!.id)) {
			return ctx.sendMessage({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Access denied."))], flags: MessageFlags.IsComponentsV2 });
		}

		const pages = [() => this.aiPage(ctx), () => this.systemPage(ctx)];
		let index = 0;

		const navRow = (disabled: boolean) => new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("nodes_prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("nodes_home").setLabel("⌂").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("nodes_next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("nodes_close").setLabel("✕").setStyle(ButtonStyle.Danger).setDisabled(disabled),
		);

		const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel("Invite").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.invite),
			new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.supportServer),
		);

		const render = (disabled = false) => ({
			components: [pages[index]!(), navRow(disabled), linkRow],
			flags: MessageFlags.IsComponentsV2,
		});

		const msg = await ctx.sendMessage(render());
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 120_000,
			filter: (i) => i.user.id === ctx.author!.id,
		});

		collector.on("collect", async (btn) => {
			await btn.deferUpdate().catch(() => {});
			if (btn.customId === "nodes_close") { collector.stop(); await msg.delete().catch(() => {}); return; }
			if (btn.customId === "nodes_prev") index = (index - 1 + pages.length) % pages.length;
			else if (btn.customId === "nodes_next") index = (index + 1) % pages.length;
			else if (btn.customId === "nodes_home") index = 0;
			await msg.edit(render()).catch(() => {});
		});

		collector.on("end", (_, reason) => {
			if (reason === "time") msg.edit(render(true)).catch(() => {});
		});
	}

	private aiPage(ctx: Context): ContainerBuilder {
		const cluster = (ctx.client as any).aiCluster;
		const lines: string[] = [];

		if (cluster) {
			const metrics = cluster.getMetrics();
			const providers = new Map<string, typeof metrics>();
			for (const m of metrics) {
				const g = providers.get(m.provider) ?? [];
				g.push(m);
				providers.set(m.provider, g);
			}

			lines.push(`**AI Cluster**`);
			lines.push(`────────────────────`);
			lines.push(`\`Nodes        \` ${cluster.availableNodes} / ${cluster.totalNodes}`);
			lines.push(`\`Race Mode    \` ${env.AI_RACE_MODE ? "Enabled" : "Disabled"}`);
			lines.push(`\`Concurrency  \` ${env.AI_MAX_CONCURRENCY}`);
			lines.push("");

			for (const [provider, nodes] of providers) {
				lines.push(`**${provider}**`);
				for (const n of nodes) {
					const status = n.onCooldown ? `COOLDOWN ${Math.ceil(n.cooldownRemainingMs / 1000)}s` : "ONLINE";
					lines.push(`\`${n.id.padEnd(14)}\` ${status} | ${n.avgLatencyMs}ms | ${n.successRate}% | ${n.totalRequests} req`);
				}
				lines.push("");
			}
		} else {
			lines.push("AI Cluster not initialized.");
		}

		lines.push("-# Page 1 of 2 — AI Nodes");

		return new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Node Status**"))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
	}

	private systemPage(ctx: Context): ContainerBuilder {
		const lines: string[] = [];

		// Shards
		const shardCount = ctx.client.ws.shards.size || 1;
		const totalGuilds = ctx.client.guilds.cache.size;
		const totalMembers = ctx.client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
		const ping = ctx.client.ws.ping;

		lines.push("**Shards**");
		lines.push("────────────────────");
		lines.push(`\`Shards       \` ${shardCount}`);
		lines.push(`\`Guilds       \` ${totalGuilds}`);
		lines.push(`\`Members      \` ${totalMembers.toLocaleString()}`);
		lines.push(`\`WS Ping      \` ${ping}ms`);
		lines.push(`\`Uptime       \` ${this.formatUptime(ctx.client.uptime ?? 0)}`);
		lines.push("");

		// Lavalink
		const manager = (ctx.client as any).manager;
		if (manager) {
			const nodes = manager.nodeManager?.nodes ?? manager.nodes ?? new Map();
			lines.push("**Lavalink**");
			lines.push("────────────────────");
			if (nodes.size === 0) {
				lines.push("`No nodes connected`");
			} else {
				for (const [id, node] of nodes) {
					const connected = node.connected ?? node.state === 1;
					const players = node.stats?.players ?? node.players?.size ?? 0;
					lines.push(`\`${String(id).padEnd(14)}\` ${connected ? "ONLINE" : "OFFLINE"} | ${players} players`);
				}
			}
			lines.push("");
		}

		// Redis
		lines.push("**Redis**");
		lines.push("────────────────────");
		const redisStatus = ctx.client.redis?.status ?? "unknown";
		lines.push(`\`Status       \` ${redisStatus === "ready" ? "CONNECTED" : redisStatus.toUpperCase()}`);
		lines.push("");

		// Memory
		const mem = process.memoryUsage();
		lines.push("**Process**");
		lines.push("────────────────────");
		lines.push(`\`RSS          \` ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
		lines.push(`\`Heap Used    \` ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);
		lines.push(`\`Node.js      \` ${process.version}`);
		lines.push("");
		lines.push("-# Page 2 of 2 — System");

		return new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Node Status**"))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
	}

	private formatUptime(ms: number): string {
		const s = Math.floor(ms / 1000);
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${d}d ${h}h ${m}m`;
	}
}
