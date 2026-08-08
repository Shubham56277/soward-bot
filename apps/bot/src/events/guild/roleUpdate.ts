import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { CustomRole } from "@repo/db";

/** Permissions that must never exist on a custom-role-managed role. */
const DANGEROUS_BITS = new PermissionsBitField([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.MentionEveryone,
    PermissionFlagsBits.ManageWebhooks,
]);

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

            // ── Custom Role protection: strip dangerous permissions instantly ──
            await this.stripDangerousFromCustomRole(newRole).catch(error => {
                this.client.logger.error(error);
            });

            try {
                const config = await this.client.services.antinukes.getConfig(guild.id);
                const actionConfig = config?.role.find(c => c.type === "update");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fetch audit logs and executor
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.RoleUpdate
                }).catch(error => {
                    this.client.logger.error(error);
                    return null;
                });

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor || log.executor.id === guild.ownerId) return;
                if (Date.now() - log.createdTimestamp > 120000) return;

                // Skip bot's own actions or trusted users
                if (log.executor.id === this.client.user?.id ||
                    log.executor.id === config.admin ||
                    await this.client.services.antinukes.isBypassed(guild, log.executor.id)) return;

                // Fetch member and check permissions
                const member = await guild.members.fetch(log.executor.id).catch(error => {
                    this.client.logger.error(error);
                    return null;
                });
                if (!member || !this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                if (actionConfig.limit <= 1) {
                    const enforced = await this.client.services.antinukes.punishUser(
                        guild,
                        log.executor.id,
                        actionConfig.action,
                        "Anti-Role Protection | Not Whitelisted",
                    );
                    if (enforced) await this.restoreRole(oldRole, newRole);
                    return;
                }

                const tracked = await this.client.services.antinukes.trackAction(guild, log.executor.id, "role-update", actionConfig);
                if (tracked) {
                    const enforced = await this.client.services.antinukes.punishUser(
                        guild,
                        log.executor.id,
                        actionConfig.action,
                        "Anti-Role Protection | Not Whitelisted",
                    );
                    if (enforced) await this.restoreRole(oldRole, newRole);
                }
            } catch (error) {
                this.client.logger.error(error);
            }
        });
    }

    private async restoreRole(oldRole: any, newRole: any): Promise<void> {
        const logError = (error: unknown) => this.client.logger.error(error);
        const restoreTasks = [
            newRole.name !== oldRole.name && newRole.setName(oldRole.name, "Anti-Role Protection").catch(logError),
            newRole.color !== oldRole.color && newRole.setColor(oldRole.color, "Anti-Role Protection").catch(logError),
            newRole.hoist !== oldRole.hoist && newRole.setHoist(oldRole.hoist, "Anti-Role Protection").catch(logError),
            newRole.mentionable !== oldRole.mentionable && newRole.setMentionable(oldRole.mentionable, "Anti-Role Protection").catch(logError),
            newRole.permissions.bitfield !== oldRole.permissions.bitfield && newRole.setPermissions(oldRole.permissions.bitfield, "Anti-Role Protection").catch(logError),
            newRole.icon !== oldRole.icon && newRole.setIcon(oldRole.icon, "Anti-Role Protection").catch(logError),
            newRole.unicodeEmoji !== oldRole.unicodeEmoji && newRole.setUnicodeEmoji(oldRole.unicodeEmoji, "Anti-Role Protection").catch(logError),
            newRole.position !== oldRole.position && newRole.setPosition(oldRole.position, { reason: "Anti-Role Protection" }).catch(logError)
        ].filter(Boolean);

        await Promise.allSettled(restoreTasks);
    }

    /**
     * If the updated role is registered as a custom role, strip any dangerous
     * permissions immediately so users can never gain Admin/ManageGuild/etc
     * through a custom-role-managed role.
     */
    private async stripDangerousFromCustomRole(role: any): Promise<void> {
        if (!role.guild || !role.permissions) return;

        // Check if the role has any dangerous permission
        const hasDangerous = DANGEROUS_BITS.toArray().some(flag => role.permissions.has(flag));
        if (!hasDangerous) return;

        // Check if this role is a registered custom role
        const config = await CustomRole.get(role.guild.id);
        if (!config?.roles?.length) return;

        const isCustomRole = config.roles.some((r: any) => r.role === role.id);
        if (!isCustomRole) return;

        // Strip dangerous permissions
        const safeBits = role.permissions.bitfield & ~DANGEROUS_BITS.bitfield;
        await role.setPermissions(safeBits, "Custom Role Protection: dangerous permissions removed").catch((error: unknown) => {
            this.client.logger.error(error);
        });
    }
}