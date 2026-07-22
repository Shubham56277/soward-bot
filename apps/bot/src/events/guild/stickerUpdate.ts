import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";
import { wait } from "../../utils/helper";

export default class GuildStickerUpdate extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
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

                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.sticker?.find(c => c.type === "update");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.StickerUpdate
                }).catch(() => null);

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

                // Ultra-fast trusted user check with cache
                let trustedSet = this.trustedCache.get(guildId);
                if (!trustedSet) {
                    trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
                    this.trustedCache.set(guildId, trustedSet);
                    setTimeout(() => this.trustedCache.delete(guildId), 30000);
                }

                if (trustedSet.has(executorId)) return;

                // Fast member check using cache first
                let member = guild.members.cache.get(executorId) as any;
                if (!member) {
                    member = await guild.members.fetch(executorId).catch(() => null);
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
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Sticker Protection | Unauthorized Update"
                    );

                    const cachedSticker = this.stickerCache.get(stickerId);
                    if (cachedSticker) {
                        await newSticker.edit({
                            name: cachedSticker.name,
                            reason: "Anti-Sticker Protection | Restored Original"
                        }).catch(() => { })
                    }
                }

            } catch (error) {
                this.client.logger?.error?.(error);
                this.stickerCache.delete(stickerId);
            }
        });
    }
}