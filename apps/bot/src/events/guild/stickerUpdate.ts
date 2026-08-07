import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";

export default class GuildStickerUpdate extends Event {
    private stickerCache = new Map<string, { name: string }>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildStickerUpdate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildStickerUpdate, async (oldSticker, newSticker) => {
            if (!newSticker.guild) return;
            const { guild, id: stickerId } = newSticker;
            const guildId = guild.id;

            // Cache old sticker data immediately
            this.stickerCache.set(stickerId, {
                name: oldSticker.name
            });

            try {
                // Skip if no meaningful changes
                if (newSticker.name === oldSticker.name) return;

                const config = await this.client.services.antinukes.getConfig(guildId);

                const actionConfig = config?.sticker?.find(c => c.type === "update");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.StickerUpdate
                }).catch(error => {
                    this.client.logger?.error?.(error);
                    return null;
                });

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

                // Fast member check using cache first
                let member = guild.members.cache.get(executorId) as any;
                if (!member) {
                    member = await guild.members.fetch(executorId).catch(error => {
                        this.client.logger?.error?.(error);
                        return null;
                    });
                    if (!member) return;
                }

                if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                const tracked = await this.client.services.antinukes.trackAction(
                    guild,
                    executorId,
                    "stickerUpdate",  // Fixed action type from "stickerCreate" to "stickerUpdate"
                    actionConfig
                );

                if (tracked) {
                    const enforced = await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Sticker Protection | Unauthorized Update"
                    );
                    if (!enforced) return;

                    const cachedSticker = this.stickerCache.get(stickerId);
                    if (cachedSticker) {
                        await newSticker.edit({
                            name: cachedSticker.name,
                            reason: "Anti-Sticker Protection | Restored Original"
                        }).catch(error => {
                            this.client.logger?.error?.(error);
                        });
                    }
                }

            } catch (error) {
                this.client.logger?.error?.(error);
                this.stickerCache.delete(stickerId);
            }
        });
    }
}