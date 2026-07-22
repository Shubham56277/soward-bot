import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class GuildBanRemove extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildBanRemove,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildBanRemove, async (ban) => {
            if (!ban.guild) return;
            const { guild } = ban;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.member?.find(c => c.type === "unban");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MemberBanRemove
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || !log.target) return;

                const executorId = log.executor.id;
                const targetId = log.target.id;
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

                if (actionConfig.limit <= 1) {
                    await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Member Protection | Not Whitelisted");

                    await guild.members.ban(targetId, {
                        reason: "Anti-Member Protection | User ReBanned"
                    }).catch(() => { });
                    return;
                }
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "memberUnban", actionConfig);

                if (tracked) {
                    await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Member Protection | Not Whitelisted");

                    await guild.members.ban(targetId, {
                        reason: "Anti-Member Protection | User ReBanned"
                    }).catch(() => { });
                }

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }
}