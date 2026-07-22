import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";

export default class GuildRoleUpdate extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildRoleUpdate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
            if (!newRole.guild) return;
            const { guild } = newRole;

            try {
                const config = await this.client.services.antinukes.getConfig(guild.id);
                const actionConfig = config?.role.find(c => c.type === "update");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fetch audit logs and executor
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.RoleUpdate
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || log.executor.id === guild.ownerId) return;
                if (Date.now() - log.createdTimestamp > 120000) return;

                // Skip bot's own actions or trusted users
                if (log.executor.id === this.client.user?.id ||
                    log.executor.id === config.admin ||
                    config.trustedUsers.some(id => id.id === log.executor?.id)) return;

                // Fetch member and check permissions
                const member = await guild.members.fetch(log.executor.id).catch(() => null);
                if (!member || !this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                if (actionConfig.limit <= 1) {
                    this.client.services.antinukes.punishUser(guild, log.executor.id, actionConfig.action, "Anti-Role Protection | Not Whitelisted");
                    this.restoreRole(oldRole, newRole);
                    return;
                }

                const tracked = await this.client.services.antinukes.trackAction(guild, log.executor.id, "role-update", actionConfig);
                if (tracked) {
                    this.restoreRole(oldRole, newRole);
                }
            } catch (error) {
                this.client.logger.error(error);
            }
        });
    }

    private restoreRole(oldRole: any, newRole: any): void {
        const restoreTasks = [
            newRole.name !== oldRole.name && newRole.setName(oldRole.name, "Anti-Role Protection").catch(() => null),
            newRole.color !== oldRole.color && newRole.setColor(oldRole.color, "Anti-Role Protection").catch(() => null),
            newRole.hoist !== oldRole.hoist && newRole.setHoist(oldRole.hoist, "Anti-Role Protection").catch(() => null),
            newRole.mentionable !== oldRole.mentionable && newRole.setMentionable(oldRole.mentionable, "Anti-Role Protection").catch(() => null),
            newRole.permissions.bitfield !== oldRole.permissions.bitfield && newRole.setPermissions(oldRole.permissions.bitfield, "Anti-Role Protection").catch(() => null),
            newRole.icon !== oldRole.icon && newRole.setIcon(oldRole.icon, "Anti-Role Protection").catch(() => null),
            newRole.unicodeEmoji !== oldRole.unicodeEmoji && newRole.setUnicodeEmoji(oldRole.unicodeEmoji, "Anti-Role Protection").catch(() => null),
            newRole.position !== oldRole.position && newRole.setPosition(oldRole.position, { reason: "Anti-Role Protection" }).catch(() => null)
        ].filter(Boolean);

        Promise.allSettled(restoreTasks);
    }
}