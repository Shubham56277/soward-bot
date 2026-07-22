import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class GuildMemberAdd extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
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
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

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
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || !log.target?.bot || log.target.id !== botId) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Cache this bot add for future checks
                this.botAddCache.set(botId, { executorId, timestamp: now });
                setTimeout(() => this.botAddCache.delete(botId), 120000);

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

            await this.client.services.antinukes.punishUser(
                guild,
                executorId,
                "ban",
                "Anti-GateKeeper Protection | Not Whitelisted"
            );
           
            await guild.members.ban(botId, {
                reason: "Anti-GateKeeper Protection | Unauthorized Bot"
            });

        } catch (error) {
            this.client.logger?.error?.(error);
        }
    }
}