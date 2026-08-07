import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, GuildMember } from "discord.js";

export default class ChannelCreate extends Event {
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
                const config = await this.client.services.antinukes.getConfig(guildId);

                const actionConfig = config?.channel?.find(c => c.type === "create");
                if (!config?.enabled || !actionConfig?.enabled) return;

                // Fetch only 1 log instead of 2 for speed
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.ChannelCreate
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
                    (now - log.createdTimestamp) > 120000) return; // 2 min check

                if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

                // Fast member check using cache first
                let member = guild.members.cache.get(executorId) as GuildMember | null;
                if (!member) {
                    member = await guild.members.fetch(executorId).catch(error => {
                        this.client.logger?.error?.(error);
                        return null;
                    });
                    if (!member) return;
                }

                if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                if (actionConfig.limit <= 1) {
                    const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Channel Protection | Not Whitelisted");
                    if (enforced) await this.client.services.antinukes.cleanupChannel(guild, executorId, channel.id);
                    return;
                }
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "channelCreate", actionConfig);

                if (tracked) {
                    const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Channel Protection | Not Whitelisted");
                    if (enforced) await this.client.services.antinukes.cleanupChannel(guild, executorId, channel.id);
                }

            } catch (error) {
                // Silent fail for max speed (optional: remove this line entirely)
                this.client.logger?.error?.(error);
            }
        });
    }
}