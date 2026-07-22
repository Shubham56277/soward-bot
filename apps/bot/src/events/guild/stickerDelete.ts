import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class GuildStickerDelete extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private stickerDeleteCache = new Map<string, { executorId: string, timestamp: number }>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildStickerDelete,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildStickerDelete, async (sticker) => {
            if (!sticker.guild) return;
            const { guild, id: stickerId } = sticker;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.sticker?.find(c => c.type === "delete");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Check cache for recent sticker deletions first
                const cachedDeletion = this.stickerDeleteCache.get(stickerId);
                if (cachedDeletion && (Date.now() - cachedDeletion.timestamp) < 120000) {
                    return this.handleStickerDeletion(guild, cachedDeletion.executorId, actionConfig);
                }

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.StickerDelete
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Cache this sticker deletion for future checks
                this.stickerDeleteCache.set(stickerId, { executorId, timestamp: now });
                setTimeout(() => this.stickerDeleteCache.delete(stickerId), 120000);

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                await this.handleStickerDeletion(guild, executorId, actionConfig);

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }

    private async handleStickerDeletion(guild: any, executorId: string, actionConfig: any): Promise<void> {
        try {
            // Ultra-fast trusted user check with cache
            let trustedSet = this.trustedCache.get(guild.id);
            if (!trustedSet) {
                const config = this.configCache.get(guild.id);
                trustedSet = new Set(config?.trustedUsers?.map(u => u.id) || []);
                this.trustedCache.set(guild.id, trustedSet);
                setTimeout(() => this.trustedCache.delete(guild.id), 30000);
            }

            if (trustedSet.has(executorId)) return;

            // Fast member check using cache first
            let member = guild.members.cache.get(executorId) as any;
            if (!member) {
                member = await guild.members.fetch(executorId).catch(() => null);
                if (!member) return;
            }

            if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;
            if (actionConfig.limit <= 1) {
                await this.client.services.antinukes.punishUser(
                    guild,
                    executorId,
                    actionConfig.action,
                    "Anti-Sticker Protection | Unauthorized Deletion"
                );
            }
            const tracked = await this.client.services.antinukes.trackAction(
                guild,
                executorId,
                "stickerDelete",  // Fixed action type from "stickerCreate" to "stickerDelete"
                actionConfig
            );

            if (tracked) {
                // Fire punishment immediately without waiting
                await this.client.services.antinukes.punishUser(
                    guild,
                    executorId,
                    actionConfig.action,
                    "Anti-Sticker Protection | Unauthorized Deletion"
                )
            }

        } catch (error) {
            this.client.logger?.error?.(error);
        }
    }
}