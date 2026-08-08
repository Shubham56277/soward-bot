import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";

export default class GuildMemberAdd extends Event {
    private botAddCache = new Map<string, { executorId: string, timestamp: number }>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildMemberAdd,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildMemberAdd, async (member) => {
            if (!member.guild || !member.user.bot) return;
            const { guild, id: botId } = member;
            const guildId = guild.id;

            try {
                const config = await this.client.services.antinukes.getConfig(guildId);

                if (!config?.gateKeeper || !config.enabled) return;

                // Check cache for recent bot adds first
                const cachedAdd = this.botAddCache.get(botId);
                if (cachedAdd && (Date.now() - cachedAdd.timestamp) < 120000) {
                    return this.handleBotAdd(guild, cachedAdd.executorId, botId);
                }

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.BotAdd
                }).catch(error => {
                    this.client.logger?.error?.(error);
                    return null;
                });

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || !log.target?.bot || log.target.id !== botId) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Cache this bot add for future checks
                this.botAddCache.set(botId, { executorId, timestamp: now });
                setTimeout(() => this.botAddCache.delete(botId), 120000).unref();

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                await this.handleBotAdd(guild, executorId, botId);

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }

    private async handleBotAdd(guild: any, executorId: string, botId: string): Promise<void> {
        try {
            if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

            // Fast member check using cache first
            let member = guild.members.cache.get(executorId) as any;
            if (!member) {
                member = await guild.members.fetch(executorId).catch((error: unknown) => {
                    this.client.logger?.error?.(error);
                    return null;
                });
                if (!member) return;
            }

            if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

            const enforced = await this.client.services.antinukes.punishUser(
                guild,
                executorId,
                "ban",
                "Anti-GateKeeper Protection | Not Whitelisted"
            );
            if (!enforced) return;

            await guild.members.ban(botId, {
                reason: "Anti-GateKeeper Protection | Unauthorized Bot"
            });

        } catch (error) {
            this.client.logger?.error?.(error);
        }
    }
}