import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";

export default class GuildBanRemove extends Event {
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
                const config = await this.client.services.antinukes.getConfig(guildId);

                const actionConfig = config?.member?.find(c => c.type === "unban");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MemberBanRemove
                }).catch(error => {
                    this.client.logger?.error?.(error);
                    return null;
                });

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

                if (actionConfig.limit <= 1) {
                    const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Member Protection | Not Whitelisted");
                    if (!enforced) return;
                    await guild.members.ban(targetId, {
                        reason: "Anti-Member Protection | User ReBanned"
                    }).catch(error => {
                        this.client.logger?.error?.(error);
                    });
                    return;
                }
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "memberUnban", actionConfig);

                if (tracked) {
                    const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Member Protection | Not Whitelisted");
                    if (!enforced) return;
                    await guild.members.ban(targetId, {
                        reason: "Anti-Member Protection | User ReBanned"
                    }).catch(error => {
                        this.client.logger?.error?.(error);
                    });
                }

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }
}