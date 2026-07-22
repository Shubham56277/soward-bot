import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, PermissionFlagsBits, RoleFlags } from "discord.js";
import { AntiNuke } from "@repo/db";

// Dangerous permissions to monitor
const DANGEROUS_PERMISSIONS = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.MentionEveryone,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ManageMessages
];

export default class GuildMemberUpdate extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private roleCache = new Map<string, string[]>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.GuildMemberUpdate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            if (!newMember.guild) return;
            const { guild, id: memberId } = newMember;
            const guildId = guild.id;

            try {
                // Cache old roles immediately
                this.roleCache.set(memberId, [...oldMember.roles.cache.keys()]);

                // Check for role changes
                const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
                const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

                // Skip if no role changes
                if (addedRoles.size === 0 && removedRoles.size === 0) return;

                // Check if any added role has dangerous permissions
                const dangerousRoles = addedRoles.filter(role => {
                    if (role.flags.has(RoleFlags.InPrompt)) return false; // Skip onboarding roles
                    return DANGEROUS_PERMISSIONS.some(perm => role.permissions.has(perm));
                });

                if (dangerousRoles.size === 0) return;

                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.member?.find(c => c.type === "update");
                if (!actionConfig?.enabled || !config.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MemberRoleUpdate
                }).catch(() => null);

                if (!logs || logs.entries.size === 0) return; // Likely Discord Onboarding

                const log = logs.entries.first();
                if (!log || !log.executor) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 3600000) return;

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

                const tracked = await this.client.services.antinukes.trackAction(
                    guild,
                    executorId,
                    "memberUpdate",
                    actionConfig
                );

                if (tracked) {
                    // Fire actions immediately without waiting
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Member-Update Protection | Not Whitelisted",

                    );
                    const cachedRoles = this.roleCache.get(memberId);
                    if (cachedRoles) {
                        await newMember.roles.set(
                            cachedRoles,
                            "Anti-Member-Update Protection | Not Whitelisted"
                        );
                    }
                }

            } catch (error) {
                this.client.logger?.error?.(error);
                this.roleCache.delete(memberId);
            }
        });
    }
}