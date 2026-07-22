import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events, Guild, WebhookClient } from "discord.js";
import { env } from "@repo/env";

export default class GuildDelete extends Event {
    private webhook?: WebhookClient;

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildDelete,
        });

        if (env.GUILD_DELETE_WEBHOOK_URL) this.webhook = new WebhookClient({ url: env.GUILD_DELETE_WEBHOOK_URL });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildDelete, async (guild: Guild) => {
            if (!guild.available) return;
            try {
                let ownerInfo = "Unknown";
                try {
                    const owner = await guild.fetchOwner();
                    ownerInfo = `${owner.user.tag} (${owner.id})`;
                } catch {
                    ownerInfo = "Could not fetch owner (left guild)";
                }

                const embed = {
                    title: `Left guild: ${guild.name}`,
                    color: 0xff0000,
                    thumbnail: {
                        url: guild.iconURL({ extension: "png", size: 1024 }) ||
                            "",
                    },
                    fields: [
                        { name: "ID", value: guild.id, inline: true },
                        { name: "Owner", value: ownerInfo, inline: true },
                        {
                            name: "Members",
                            value: guild.memberCount?.toString() || "Unknown",
                            inline: true,
                        },
                        {
                            name: "Created At",
                            value: guild.createdAt.toUTCString(),
                            inline: true,
                        },
                        {
                            name: "Left At",
                            value: new Date().toUTCString(),
                            inline: true,
                        },
                    ],
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: `Now in ${this.client.guilds.cache.size} guilds`,
                    },
                };

                // Send to webhook
                await this.webhook?.send({
                    embeds: [embed],
                    username: "Guild Logger",
                    avatarURL: this.client.user?.displayAvatarURL(),
                });

                this.client.logger.warn(
                    `Left guild: ${guild.name} (${guild.id}) with ${
                        guild.memberCount || "unknown"
                    } members.`,
                );
            } catch (error) {
                this.client.logger.error(
                    `Failed to log guild delete event for ${guild.id}:`,
                    error,
                );
            }
        });
    }
}
