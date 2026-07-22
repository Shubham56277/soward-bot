import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke, AntiNukeMember } from "@repo/db";

export default class GuildMemberRemove extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private kickCache = new Map<string, { executorId: string, timestamp: number }>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildMemberRemove,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildMemberRemove, async (member) => {
            if (!member.guild) return;
            const { guild, id: memberId } = member;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.member?.find(c => c.type === "kick");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Check cache for recent kicks first
                const cachedKick = this.kickCache.get(memberId);
                if (cachedKick && (Date.now() - cachedKick.timestamp) < 120000) {
                    return this.handleMemberKick(guild, cachedKick.executorId, memberId, actionConfig);
                }

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MemberKick
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || !log.target) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Cache this kick for future checks
                this.kickCache.set(memberId, { executorId, timestamp: now });
                setTimeout(() => this.kickCache.delete(memberId), 120000);

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                await this.handleMemberKick(guild, executorId, memberId, actionConfig);

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }

    private async handleMemberKick(guild: any, executorId: string, memberId: string, actionConfig: AntiNukeMember): Promise<void> {
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
                await this.client.services.antinukes.trackAction(guild, executorId, "memberKick", actionConfig);
                return;
            }
            const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "memberKick", actionConfig);

            if (tracked) {

                await this.client.services.antinukes.punishUser(
                    guild,
                    executorId,
                    actionConfig.action,
                    "Anti-Member Protection | Unauthorized Kick",
                );
            }

        } catch (error) {
            this.client.logger?.error?.(error);
        }
    }
}