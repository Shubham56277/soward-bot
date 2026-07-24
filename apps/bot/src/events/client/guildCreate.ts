import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events, Guild, WebhookClient } from "discord.js";
import { env } from "@repo/env";

export default class GuildCreate extends Event {
    private webhook?: WebhookClient;

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildCreate,
        });

        if (env.GUILD_CREATE_WEBHOOK_URL) this.webhook = new WebhookClient({ url: env.GUILD_CREATE_WEBHOOK_URL });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildCreate, async (guild: Guild) => {
        
            try {
                const owner = await guild.fetchOwner();
                const channels = guild.channels.cache;
                const roles = guild.roles.cache;
                const emojis = guild.emojis.cache;
                const stickers = guild.stickers.cache;
                const members = guild.members.cache;
                const bans = await guild.bans.fetch().catch(() => null);

                // Create embed with guild information
                const embed = {
                    title: `Joined a new guild: ${guild.name}`,
                    color: 0x000000,
                    thumbnail: {
                        url: guild.iconURL({ extension: "png", size: 1024 }) ||
                            "",
                    },
                    fields: [
                        { name: "ID", value: guild.id, inline: true },
                        {
                            name: "Owner",
                            value: `${owner.user.tag} (${owner.id})`,
                            inline: true,
                        },
                        {
                            name: "Members",
                            value: guild.memberCount.toString(),
                            inline: true,
                        },
                        {
                            name: "Created At",
                            value: guild.createdAt.toUTCString(),
                            inline: true,
                        },
                        {
                            name: "Channels",
                            value: channels.size.toString(),
                            inline: true,
                        },
                        {
                            name: "Roles",
                            value: roles.size.toString(),
                            inline: true,
                        },
                        {
                            name: "Members",
                            value: members.size.toString(),
                            inline: true,
                        },
                        {
                            name: "Emojis",
                            value: emojis.size.toString(),
                            inline: true,
                        },
                        {
                            name: "Stickers",
                            value: stickers.size.toString(),
                            inline: true,
                        },
                        {
                            name: "Bans",
                            value: bans?.size?.toString() || "0",
                            inline: true,
                        },
                        {
                            name: "Boost Level",
                            value: guild.premiumTier.toString(),
                            inline: true,
                        },
                        {
                            name: "Boost Count",
                            value: guild.premiumSubscriptionCount?.toString() ||
                                "0",
                            inline: true,
                        },
                        {
                            name: "Verification Level",
                            value: guild.verificationLevel.toString(),
                            inline: true,
                        },
                    ],
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: `Guild #${this.client.guilds.cache.size}`,
                    },
                };

                // Send to webhook
                await this.webhook?.send({
                    embeds: [embed],
                    username: "Guild Logger",
                    avatarURL: this.client.user?.displayAvatarURL(),
                });

                this.client.logger.info(
                    `Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members.`,
                );
            } catch (error) {
                this.client.logger.error(
                    `Failed to log guild create event for ${guild.id}:`,
                    error,
                );
            }
        });
    }
}
