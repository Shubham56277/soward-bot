import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class GuildRoleCreate extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private roleCreateCache = new Map<string, { executorId: string, timestamp: number }>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildRoleCreate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildRoleCreate, async (role) => {
            if (!role.guild || role.managed) return;
            const { guild, id: roleId } = role;
            const guildId = guild.id;

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.role?.find(c => c.type === "create");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Check cache for recent role creations first
                const cachedCreation = this.roleCreateCache.get(roleId);
                if (cachedCreation && (Date.now() - cachedCreation.timestamp) < 120000) {
                    return this.handleRoleCreation(guild, cachedCreation.executorId, roleId, actionConfig);
                }

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.RoleCreate
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Cache this role creation for future checks
                this.roleCreateCache.set(roleId, { executorId, timestamp: now });
                setTimeout(() => this.roleCreateCache.delete(roleId), 120000);

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                await this.handleRoleCreation(guild, executorId, roleId, actionConfig);

            } catch (error) {
                this.client.logger?.error?.(error);
            }
        });
    }

    private async handleRoleCreation(guild: any, executorId: string, roleId: string, actionConfig: any): Promise<void> {
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
                    "Anti-Role Protection | Unauthorized Role Creation"
                );
                await guild.roles.delete(roleId, "Anti-Role Protection | Unauthorized Role")
                    .catch(() => null);
                return;
            }
            const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "roleCreate", actionConfig);

            if (tracked) {
                // Fire actions immediately without waiting
                await this.client.services.antinukes.punishUser(
                    guild,
                    executorId,
                    actionConfig.action,
                    "Anti-Role Protection | Unauthorized Role Creation"
                );
                await guild.roles.delete(roleId, "Anti-Role Protection | Unauthorized Role")
                    .catch(() => null);

            }

        } catch (error) {
            this.client.logger?.error?.(error);
        }
    }
}