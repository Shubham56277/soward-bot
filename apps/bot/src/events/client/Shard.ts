import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { WebhookClient } from "discord.js";
import { Events } from "discord.js";
import { env } from "@repo/env";

export default class ShardEvent extends Event {
    private webhook?: WebhookClient;

    constructor(client: BaseClient) {
        super(client, {
            event: "ready",
        });

        if (env.SHARD_WEBHOOK_URL) this.webhook = new WebhookClient({ url: env.SHARD_WEBHOOK_URL });
    }

    public async execute(): Promise<void> {
        this.client.logger.start("[startup] registering shard diagnostics");
        // Shard Ready
        this.client.on(Events.ShardReady, (shardId: number) => {
            this.logShardEvent(
                shardId,
                "Ready",
                0x00ff00,
                "Shard is ready and connected",
            );
        });

        // Shard Reconnecting
        this.client.on(Events.ShardReconnecting, (shardId: number) => {
            this.logShardEvent(
                shardId,
                "Reconnecting",
                0xffff00,
                "Shard is reconnecting...",
            );
        });

        // Shard Disconnected

        this.client.on(
            Events.ShardDisconnect,
            (closeEvent, shardId) => {
                this.logShardEvent(
                    shardId,
                    "Disconnected",
                    0xff0000,
                    `Shard disconnected (Code: ${closeEvent.code}, Reason: ${
                        closeEvent.reason || "None"
                    })`,
                );
            },
        );

        // Shard Resumed
        this.client.on(
            Events.ShardResume,
            (shardId: number, replayedEvents: number) => {
                this.logShardEvent(
                    shardId,
                    "Resumed",
                    0x00ffff,
                    `Shard resumed connection (Replayed ${replayedEvents} events)`,
                );
            },
        );

        // Shard Error
        this.client.on(Events.ShardError, (error: Error, shardId: number) => {
            this.logShardEvent(
                shardId,
                "Error",
                0xff0000,
                `Shard encountered an error: ${error.message}`,
                error.stack,
            );
        });
        this.client.logger.success("[startup] shard diagnostics registered");
    }

    private async logShardEvent(
        shardId: number,
        eventName: string,
        color: number,
        description: string,
        errorDetails?: string,
    ): Promise<void> {
        try {
            const embed = {
                title: `Shard ${shardId} ${eventName}`,
                color: color,
                description: description,
                fields: [
                    {
                        name: "Timestamp",
                        value: new Date().toUTCString(),
                        inline: true,
                    },
                    {
                        name: "Total Shards",
                        value: this.client.cluster.shards.size.toString(),
                        inline: true,
                    },
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Shard ${shardId}/${
                        this.client.shard?.count ?? 1
                    } | ${this.client.cluster?.id ?? 0}/${
                        this.client.cluster?.count ?? 1
                    }`,
                },
            };

            // Add error details if available
            if (errorDetails) {
                (embed as any).fields.push({
                    name: "Error Details",
                    value: `\`\`\`${errorDetails.substring(0, 1000)}\`\`\``,
                });
            }

            await this.webhook?.send({
                embeds: [embed],
                username: "Shard Monitor",
                avatarURL: this.client.user?.displayAvatarURL(),
            });

            this.client.logger[
                color === 0xff0000
                    ? "error"
                    : color === 0xffff00
                    ? "warn"
                    : "info"
            ](
                `Shard ${shardId} ${eventName}: ${description}`,
            );
        } catch (error) {
            this.client.logger.error("Failed to log shard event:", error);
        }
    }
}
