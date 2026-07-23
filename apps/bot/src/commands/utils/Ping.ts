import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { getLatencyMonitor } from "../../modules/health";

export default class Ping extends Command {
    constructor() {
        super({
            name: "ping",
            description: {
                content: "Shows the ping of the bot.",
                examples: ["ping"],
                usage: "ping",
            },
            category: "utils",
            aliases: ["pong"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
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
        const msg = await ctx.sendDeferMessage("Measuring latency...");

        const commandLatency = msg.createdTimestamp - ctx.createdTimestamp;
        const gatewayPing = Math.round(ctx.client.ws.ping);
        const monitor = getLatencyMonitor();
        const gatewayStats = monitor?.getGatewayStats();
        const eventLoopStats = monitor?.getEventLoopStats();

        // Determine status based on gateway ping
        let status: string;
        let statusColor: number;
        if (gatewayPing < 0) {
            status = "Connecting...";
            statusColor = 0xffff00;
        } else if (gatewayPing <= 150) {
            status = "Excellent";
            statusColor = 0x00ff00;
        } else if (gatewayPing <= 300) {
            status = "Good";
            statusColor = 0x7cfc00;
        } else if (gatewayPing <= 500) {
            status = "Fair";
            statusColor = 0xffa500;
        } else {
            status = "Poor";
            statusColor = 0xff0000;
        }

        // Check Lavalink connectivity
        let lavalinkPing = "N/A";
        try {
            const nodes = (ctx.client as any).manager?.nodeManager?.nodes;
            if (nodes && nodes.size > 0) {
                const connectedNodes = [...nodes.values()].filter((n: any) => n.connected);
                if (connectedNodes.length > 0) {
                    lavalinkPing = `${connectedNodes.length} node(s) connected`;
                } else {
                    lavalinkPing = "Disconnected";
                }
            }
        } catch {}

        const lines = [
            `**Discord Gateway:** ${gatewayPing}ms`,
            `**Command Round Trip:** ${commandLatency}ms`,
        ];

        if (gatewayStats && gatewayStats.samples > 1) {
            lines.push(`**Gateway Average:** ${gatewayStats.average}ms`);
            lines.push(`**Gateway p95:** ${gatewayStats.p95}ms`);
        }

        if (eventLoopStats) {
            lines.push(`**Event Loop p95:** ${eventLoopStats.p95}ms`);
        }

        lines.push(`**Lavalink:** ${lavalinkPing}`);
        lines.push(`**Status:** ${status}`);

        if (monitor && monitor.reconnectCount > 0) {
            lines.push(`**Reconnects:** ${monitor.reconnectCount}`);
        }

        const embed = new EmbedBuilder()
            .setTitle("🏓 Pong!")
            .setDescription(lines.join("\n"))
            .setColor(statusColor)
            .setFooter({ text: `Shard ${ctx.guild?.shardId ?? 0} • ${gatewayStats?.samples ?? 0} samples collected` })
            .setTimestamp();

        return ctx.editMessage({ content: null, embeds: [embed] });
    }
}
