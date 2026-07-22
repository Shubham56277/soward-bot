import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class GuildRoleDelete extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private roleCache = new Map<string, any>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildRoleDelete,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildRoleDelete, async (role) => {
            if (!role.guild || role.managed) return;
            const { guild, id: roleId } = role;
            const guildId = guild.id;

            // Cache role data immediately
            this.roleCache.set(roleId, {
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                permissions: role.permissions,
                position: role.rawPosition,
                mentionable: role.mentionable
            });

            try {
                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.role?.find(c => c.type === "delete");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.RoleDelete
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
                if (actionConfig.limit <= 1) {
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Role Protection | Unauthorized Role Deletion",

                    );
                    const cachedRole = this.roleCache.get(roleId);
                    if (cachedRole) {
                        await guild.roles.create({
                            ...cachedRole,
                            reason: "Anti-Role Protection | Role Restoration"
                        }).catch(() => { });
                    }
                    return;
                }
                const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "roleDelete", actionConfig);

                if (tracked) {
                    // Fire actions immediately without waiting
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Role Protection | Unauthorized Role Deletion",

                    );
                    const cachedRole = this.roleCache.get(roleId);
                    if (cachedRole) {
                        await guild.roles.create({
                            ...cachedRole,
                            reason: "Anti-Role Protection | Role Restoration"
                        }).catch(() => { });
                    }
                }

            } catch (error) {
                this.client.logger?.error?.(error);
                this.roleCache.delete(roleId);
            }
        });
    }
}