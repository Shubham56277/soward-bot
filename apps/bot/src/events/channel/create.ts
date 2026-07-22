import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, GuildMember } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class ChannelCreate extends Event {
    // Cache for rapid lookups
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.ChannelCreate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.ChannelCreate, async (channel) => {
            if (!channel.guild) return;
            const { guild } = channel;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    // Auto-expire cache after 30 seconds
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.channel?.find(c => c.type === "create");
                if (!actionConfig?.enabled) return;

                // Fetch only 1 log instead of 2 for speed
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.ChannelCreate
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
                    (now - log.createdTimestamp) > 120000) return; // 2 min check

                // Ultra-fast trusted user check with cache
                let trustedSet = this.trustedCache.get(guildId);
                if (!trustedSet) {
                    trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
                    this.trustedCache.set(guildId, trustedSet);
                    setTimeout(() => this.trustedCache.delete(guildId), 30000);
                }

                if (trustedSet.has(executorId)) return;

                // Fast member check using cache first
                let member = guild.members.cache.get(executorId) as GuildMember | null;
                if (!member) {
                    member = await guild.members.fetch(executorId).catch(() => null);
                    if (!member) return;
                }

                if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                if (actionConfig.limit <= 1) {
                    // Fire both operations simultaneously without waiting
                    await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Channel Protection | Not Whitelisted");

                    this.client.services.antinukes.cleanupChannels(guild, executorId);
                    return;
                }
                // Track action and handle punishment
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "channelCreate", actionConfig);

                if (tracked) {
                    // Fire both operations simultaneously without waiting
                    await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Channel Protection | Not Whitelisted");

                    this.client.services.antinukes.cleanupChannels(guild, executorId);
                }

            } catch (error) {
                // Silent fail for max speed (optional: remove this line entirely)
                this.client.logger?.error?.(error);
            }
        });
    }
}