import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { db, sql } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Ping extends Command {
    constructor() {
        super({
            name: "ping",
            description: {
                content: "Shows the bot's latency.",
                examples: ["ping"],
                usage: "ping",
            },
            category: "utils",
            aliases: ["pong", "latency"],
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
        const msg = await ctx.sendDeferMessage("** **");

        const wsLatency = ctx.client.ws.ping;

        let dbLatency: number;
        try {
            const dbStart = performance.now();
            await db.execute(sql`SELECT 1`);
            dbLatency = Math.round(performance.now() - dbStart);
        } catch {
            dbLatency = -1;
        }

        let redisLatency: number;
        try {
            const redisStart = performance.now();
            await ctx.client.redis.ping();
            redisLatency = Math.round(performance.now() - redisStart);
        } catch {
            redisLatency = -1;
        }

        const panel = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                [
                    "## Bot's Latency",
                    `> Websocket Latency : \`${wsLatency}\` ms`,
                    `> PostgreSQL : \`${dbLatency >= 0 ? dbLatency : "N/A"}\` ms`,
                    `> Redis Cache : \`${redisLatency >= 0 ? redisLatency : "N/A"}\` ms`,
                ].join("\n")
            ));

        return ctx.editMessage({ content: null, components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
}
