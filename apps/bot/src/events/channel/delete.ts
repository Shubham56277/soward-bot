import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class ChannelDelete extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.ChannelDelete,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.ChannelDelete, async (channel) => {
            if (channel.isDMBased() || !channel.guild) return;
            const { guild } = channel;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.channel?.find(c => c.type === "delete");
                if (!actionConfig?.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.ChannelDelete
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

                // Track action and handle punishment
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "channelDelete", actionConfig);

                if (tracked) {
                    // Fire punishment immediately without waiting
                    await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Channel Protection | Not Whitelisted"
                    );

                    const cloned = await channel.clone().catch(() => null);
                    if (cloned) {
                        const updates = [];
                        if (channel.position !== undefined) updates.push(cloned.setPosition(channel.position));
                        if (channel.parentId) updates.push(cloned.setParent(channel.parentId));
                        await Promise.allSettled(updates);
                    }
                }

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }
}