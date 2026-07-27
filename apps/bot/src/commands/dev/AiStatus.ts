import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { env } from "@repo/env";

export default class AiStatus extends Command {
	constructor() {
		super({
			name: "aistatus",
			description: { content: "Show AI cluster status", examples: ["aistatus"], usage: "aistatus" },
			category: "dev",
			cooldown: 5,
			args: false,
			permissions: { dev: true, client: ["SendMessages", "ViewChannel"], user: [] },
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!env.DEVELOPER_IDS.includes(ctx.author!.id)) {
			return ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Access denied."))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const cluster = (ctx.client as any).aiCluster;
		if (!cluster) {
			return ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("AI Cluster Manager not initialized."))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const metrics = cluster.getMetrics();

		const providerGroups = new Map<string, typeof metrics>();
		for (const m of metrics) {
			const group = providerGroups.get(m.provider) ?? [];
			group.push(m);
			providerGroups.set(m.provider, group);
		}

		const lines: string[] = [
			`**AI Cluster Status**`,
			`────────────────────`,
			`Nodes: ${cluster.availableNodes} / ${cluster.totalNodes} available`,
			"",
		];

		for (const [provider, nodes] of providerGroups) {
			lines.push(`**${provider}** (${nodes.length} node${nodes.length !== 1 ? "s" : ""})`);
			for (const node of nodes) {
				const status = node.onCooldown
					? `COOLDOWN ${Math.ceil(node.cooldownRemainingMs / 1000)}s`
					: node.enabled ? "HEALTHY" : "DISABLED";
				lines.push(`  ${node.id} — ${status} | ${node.avgLatencyMs}ms | ${node.successRate}% | ${node.totalRequests} reqs | ${node.activeRequests} active | score: ${node.healthScore}`);
			}
			lines.push("");
		}

		const body = lines.join("\n");
		return ctx.sendMessage({
			components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(body))],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
