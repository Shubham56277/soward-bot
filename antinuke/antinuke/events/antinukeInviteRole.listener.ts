import {
  AuditLogEvent,
  Guild,
  GuildMember,
  Invite,
  PermissionFlagsBits,
  Role,
} from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import {
  getAntiNukeConfig,
  addAntiNukeIncident,
  addAntiNukeAudit,
} from "../client/antinukeStore";
import { isGuildPremiumActive } from "../../utils/premiumGuard";
import { sendIncidentLog } from "../client/antinukeRuntime";
import logger from "../../utils/logger";

/**
 * ── Anti-Nuke: Invite Link with Dangerous Role Protection ─────────────────
 *
 * Discord allows selecting "Roles (Optional)" when creating an invite link.
 * Anyone who joins via that invite auto-receives the selected roles.
 *
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║  THREAT:                                                                 ║
 * ║  An attacker creates an invite with a role that has Administrator,       ║
 * ║  ManageGuild, ManageRoles, or ManageChannels — letting anyone who        ║
 * ║  joins instantly gain dangerous permissions.                             ║
 * ╠════════════════════════════════════════════════════════════════════════════╣
 * ║  DETECTION:                                                              ║
 * ║  1. inviteCreate fires                                                   ║
 * ║  2. Fetch AuditLog → InviteCreate to extract `role_ids`                  ║
 * ║  3. Resolve each role → check for dangerous permissions                  ║
 * ║  4. If dangerous roles found:                                            ║
 * ║     • Check if creator is server owner / extraOwner / whitelisted        ║
 * ║     • If NOT → instant punish (ban + role strip) + delete invite         ║
 * ║     • If YES → allow but still log a warning                             ║
 * ║  5. Normal roles (no dangerous perms) → always allow silently            ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */

/** Permissions considered dangerous when attached to an invite link. */
const DANGEROUS_INVITE_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
];
const INVITE_AUDIT_CACHE_TTL_MS = 5_000;
const inviteAuditCache = new Map<string, { fetchedAt: number; entries: any[] }>();
const pendingInviteAuditFetches = new Map<string, Promise<any[]>>();

export default class AntiNukeInviteRoleListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "inviteCreate",
      once: false,
    });
  }

  public async run(invite: Invite): Promise<void> {
    if (!invite.guild) return;

    const guildId = invite.guild.id;

    // Resolve to full Guild object
    const guild =
      this.client.guilds.cache.get(guildId) ||
      (await this.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;

    try {
      logger.debug(`[ ANTINUKE ] Anti invite role: inviteCreate fired for ${invite.code} in ${guildId}`);

      // ── 1. Premium + AntiNuke gate ──────────────────────────────────────
      const premiumActive = await isGuildPremiumActive(guildId);
      if (!premiumActive) {
         logger.debug(`[ ANTINUKE ] Anti invite role: Premium not active in ${guildId}, returning early.`);
         return;
      }

      const config = await getAntiNukeConfig(guildId);
      if (!config || !config.enabled) {
         logger.debug(`[ ANTINUKE ] Anti invite role: AntiNuke not enabled in ${guildId}, returning early.`);
         return;
      }

      // Check if the antiInviteRole module is enabled (defaults to true if not explicitly disabled)
      const moduleEnabled = config.moduleStates?.antiInviteRole !== false;
      if (!moduleEnabled) {
         logger.debug(`[ ANTINUKE ] Anti invite role: Module not enabled in ${guildId}, returning early.`);
         return;
      }

      // ── 2. Fetch Invite Data to check for roles immediately ────────────
      const roleIds = await this.extractInviteRoleIds(guild, invite.code);
      logger.debug(`[ ANTINUKE ] Anti invite role: Extracted role IDs for ${invite.code}: [${roleIds.join(', ')}]`);

      // No roles attached to the invite → nothing to check
      if (!roleIds || roleIds.length === 0) return;

      // ── 3. Wait briefly for audit log propagation only if needed ───────
      // We only wait if we actually found dangerous roles and might need audit logs
      // to resolve the executor. We will do this later if executorId is missing.

      // No roles attached to the invite → nothing to check
      if (!roleIds || roleIds.length === 0) return;

      // ── 4. Resolve roles and check for dangerous permissions ───────────
      const dangerousRoles: Role[] = [];
      const normalRoles: Role[] = [];

      for (const roleId of roleIds) {
        const role =
          guild.roles.cache.get(roleId) ||
          (await guild.roles.fetch(roleId).catch(() => null));
        if (!role) continue;

        const isDangerous = DANGEROUS_INVITE_ROLE_PERMISSIONS.some((perm) =>
          role.permissions.has(perm),
        );

        if (isDangerous) {
          dangerousRoles.push(role);
        } else {
          normalRoles.push(role);
        }
      }

      // No dangerous roles → allow silently
      if (dangerousRoles.length === 0) {
        logger.debug(
          `[ ANTINUKE ] Invite ${invite.code} in ${guild.id} has roles but none are dangerous. Allowing.`,
        );
        return;
      }

      // ── 5. Identify the invite creator ─────────────────────────────────
      let executorId: string | null = invite.inviterId || null;

      // Fallback: fetch from audit log if not available on the invite object
      if (!executorId) {
        // Now we wait for audit logs since we actually need them
        await new Promise((r) => setTimeout(r, 1500));
        executorId = await this.resolveInviteCreator(guild, invite.code);
      }

      if (!executorId) {
        logger.warn(
          `[ ANTINUKE ] ⚠️ Invite ${invite.code} has dangerous roles but executor is unknown. Deleting invite.`,
        );
        await this.deleteInvite(guild, invite.code);
        return;
      }

      // ── 6. Bypass checks ──────────────────────────────────────────────
      const isOwner = executorId === guild.ownerId;
      const isExtraOwner =
        Array.isArray(config.extraOwnerIds) && config.extraOwnerIds.includes(executorId);
      const isBotSelf = executorId === this.client.user?.id;

      // Whitelisted user / role check
      const whitelistAction = "linkRole";
      const profile = config.whitelistAccess?.[executorId];
      const isWhitelistedUser =
        Boolean(profile?.fullAccess) ||
        Boolean(profile && Array.isArray(profile.actions) && profile.actions.includes(whitelistAction as any)) ||
        (Array.isArray(config.whitelistUserIds) && config.whitelistUserIds.includes(executorId));
      const executorMemberForWhitelist = await guild.members.fetch(executorId).catch(() => null);
      const hasLegacyWhitelistedRole = Boolean(
        executorMemberForWhitelist
        && Array.isArray(config.whitelistRoleIds)
        && config.whitelistRoleIds.some((roleId) => executorMemberForWhitelist.roles.cache.has(roleId)),
      );
      const hasProfileWhitelistedRole = Boolean(
        executorMemberForWhitelist
        && config.whitelistRoleAccess
        && Object.entries(config.whitelistRoleAccess).some(([roleId, roleProfile]) => {
          if (!executorMemberForWhitelist.roles.cache.has(roleId)) return false;
          if (!roleProfile || typeof roleProfile !== "object") return false;
          const full = Boolean((roleProfile as any).fullAccess);
          const actions = Array.isArray((roleProfile as any).actions) ? (roleProfile as any).actions : [];
          return full || actions.includes(whitelistAction);
        }),
      );
      const isWhitelistedRole = hasLegacyWhitelistedRole || hasProfileWhitelistedRole;
      const isWhitelisted = isWhitelistedUser || isWhitelistedRole;

      const dangerousRoleNames = dangerousRoles
        .map((r) => `**${r.name}** (\`${r.id}\`)`)
        .join(", ");
      const dangerousPermsList = this.formatDangerousPerms(dangerousRoles);

      if (isOwner || isExtraOwner || isBotSelf || isWhitelisted) {
        // Allowed but still log a warning
        logger.info(
          `[ ANTINUKE ] Invite ${invite.code} by ${executorId} has dangerous roles [${dangerousRoles.map(r => r.name).join(", ")}] — user is ${isOwner ? "owner" : isExtraOwner ? "extraOwner" : isWhitelisted ? "whitelisted" : "bot-self"}. Allowing.`,
        );

        await sendIncidentLog(
          guild,
          config.logChannelId,
          "⚠️ Invite with Dangerous Roles (Allowed)",
          [
            `**Invite Creator:** <@${executorId}> (\`${executorId}\`)`,
            `**Invite Code:** \`${invite.code}\``,
            `**Dangerous Roles:** ${dangerousRoleNames}`,
            `**Permissions:** ${dangerousPermsList}`,
            "",
            `> ⚠️ This invite was allowed because the creator is ${isOwner ? "the **server owner**" : isExtraOwner ? "an **extra owner**" : "**whitelisted** (user or role)"}.`,
            `> Members joining via this invite will auto-receive these dangerous roles.`,
          ].join("\n"),
          {
            action: "guildUpdate",
            executorId,
            isNearMiss: true,
          },
        ).catch(() => null);

        return;
      }

      // ── 7. NOT WHITELISTED — PUNISH ────────────────────────────────────
      logger.warn(
        `[ ANTINUKE ] 🚫 DANGEROUS INVITE ROLE detected in ${guild.name} (${guild.id})! ` +
          `User ${executorId} created invite ${invite.code} with dangerous roles: ${dangerousRoles.map(r => r.name).join(", ")}`,
      );

      // 7a. Delete the dangerous invite immediately
      await this.deleteInvite(guild, invite.code);

      // 7b. Punish the creator
      const executorMember = await guild.members
        .fetch(executorId)
        .catch(() => null);

      await this.punishInviteCreator(guild, executorId, executorMember);

      // ── 8. Record incident ─────────────────────────────────────────────
      await addAntiNukeIncident({
        guildId: guild.id,
        executorId,
        action: "guildUpdate",
        punishment: "ban",
        contextLabel: `[ANTI INVITE ROLE] Created invite ${invite.code} with dangerous roles: ${dangerousRoles.map(r => r.name).join(", ")}`,
        threshold: 0,
      }).catch(() => null);

      // Audit trail
      await addAntiNukeAudit(
        guild.id,
        executorId,
        "dangerousInviteRole",
        {
          type: "invite_with_dangerous_roles",
          inviteCode: invite.code,
          dangerousRoles: dangerousRoles.map((r) => ({
            id: r.id,
            name: r.name,
            permissions: r.permissions.bitfield.toString(),
          })),
          normalRoles: normalRoles.map((r) => ({
            id: r.id,
            name: r.name,
          })),
          punishment: "ban + role_strip",
          inviteDeleted: true,
        },
      ).catch(() => null);

      // ── 9. Send incident log ───────────────────────────────────────────
      await sendIncidentLog(
        guild,
        config.logChannelId,
        "🚫 Dangerous Invite Role — Unauthorized",
        [
          `**⚠️ Someone created an invite link that auto-assigns dangerous roles!**`,
          "",
          `**Executor:** <@${executorId}> (\`${executorId}\`)`,
          `**Invite Code:** \`${invite.code}\` (deleted ✅)`,
          "",
          `**Dangerous Roles on Invite:**`,
          ...dangerousRoles.map(
            (r) =>
              `> 🔴 **${r.name}** — ${this.formatRolePerms(r)}`,
          ),
          "",
          `**Punishment:** Banned <@${executorId}> + all roles stripped`,
          "",
          `> *This user was NOT whitelisted. Creating invite links with*`,
          `> *Admin/ManageServer/ManageRoles/ManageChannels is forbidden.*`,
        ].join("\n"),
        {
          action: "guildUpdate",
          executorId,
          punishment: "ban",
          threshold: 0,
          isHighRisk: true,
        },
      ).catch(() => null);

      // ── 10. DM server owner ────────────────────────────────────────────
      if (config.notifyOwner) {
        await this.dmOwner(guild, executorId, dangerousRoles, invite.code);
      }

      logger.warn(
        `[ ANTINUKE ] Dangerous invite role handling complete — executor: ${executorId}, invite: ${invite.code}, roles: ${dangerousRoles.map(r => r.name).join(", ")}`,
      );
    } catch (err) {
      logger.debug(
        `[ ANTINUKE ] Anti invite role error in ${guildId}: ${err}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Extract the role IDs attached to an invite from the Audit Log.
   * Discord stores these in the InviteCreate audit entry's `changes` or `extra`.
   */
  private async extractInviteRoleIds(
    guild: Guild,
    inviteCode: string,
  ): Promise<string[]> {
    // ── Method 1: Direct REST API call to GET /invites/{code} ─────────
    // The Discord API returns a `roles` array with partial role objects
    // containing { id, name, ... } when roles are attached to an invite.
    try {
      const rawData = await this.client.rest.get(
        `/invites/${inviteCode}`,
      ) as any;

      logger.debug(
        `[ ANTINUKE ] Anti invite role: raw invite data for ${inviteCode}: ${JSON.stringify({
          type: rawData?.type,
          hasRoles: Boolean(rawData?.roles?.length),
          roleCount: rawData?.roles?.length ?? 0,
          roles: rawData?.roles?.map((r: any) => ({ id: r.id, name: r.name })),
          roleIdsField: rawData?.role_ids,
        })}`,
      );

      // Check for `roles` array (partial role objects with id)
      if (rawData?.roles && Array.isArray(rawData.roles) && rawData.roles.length > 0) {
        const ids: string[] = rawData.roles
          .map((r: any) => r?.id)
          .filter((id: any): id is string => typeof id === "string");
        if (ids.length > 0) return [...new Set(ids)];
      }

      // Check for `role_ids` array (some API versions return this directly)
      if (rawData?.role_ids && Array.isArray(rawData.role_ids)) {
        const ids: string[] = rawData.role_ids.filter((id: any): id is string => typeof id === "string");
        if (ids.length > 0) return [...new Set(ids)];
      }
    } catch (err) {
      logger.debug(
        `[ ANTINUKE ] Anti invite role: REST invite fetch failed for ${inviteCode}: ${err}`,
      );
    }

    // ── Method 2: Fetch invite via guild manager and inspect raw data ──
    try {
      const fetchedInvites = await guild.invites.fetch().catch(() => null);
      if (fetchedInvites) {
        const inv = fetchedInvites.get(inviteCode);
        if (inv) {
          const rawInvite = inv as any;

          // Check various possible property names
          if (rawInvite.roles && Array.isArray(rawInvite.roles) && rawInvite.roles.length > 0) {
            const ids: string[] = rawInvite.roles
              .map((r: any) => typeof r === "string" ? r : r?.id)
              .filter((id: any): id is string => typeof id === "string");
            if (ids.length > 0) return [...new Set(ids)];
          }

          if (rawInvite.role_ids && Array.isArray(rawInvite.role_ids)) {
            return rawInvite.role_ids.filter((id: any): id is string => typeof id === "string");
          }

          // Check toJSON
          const json = inv.toJSON() as any;
          if (json.roles && Array.isArray(json.roles)) {
            const ids: string[] = json.roles
              .map((r: any) => typeof r === "string" ? r : r?.id)
              .filter((id: any): id is string => typeof id === "string");
            if (ids.length > 0) return [...new Set(ids)];
          }
          if (json.role_ids && Array.isArray(json.role_ids)) {
            return json.role_ids.filter((id: any): id is string => typeof id === "string");
          }
        }
      }
    } catch {
      // fallback failed
    }

    // ── Method 3: Audit log fallback ──────────────────────────────────
    try {
      const auditEntries = await this.getCachedInviteCreateAuditEntries(guild);
      for (const entry of auditEntries) {
        if (Date.now() - entry.createdTimestamp > 30_000) continue;

        const codeChange = entry.changes?.find(
          (c: any) => c.key === "code" && c.new === inviteCode,
        );
        if (!codeChange) continue;

        const roleIdsRaw: string[] = [];

        // Scan all changes cast to any
        for (const change of (entry.changes || []) as any[]) {
          if ((change.key === "role_ids" || change.key === "roles") && Array.isArray(change.new)) {
            for (const item of change.new) {
              if (typeof item === "string") roleIdsRaw.push(item);
              else if (typeof item === "object" && item?.id) roleIdsRaw.push(item.id);
            }
          }
        }

        // Check extra and target
        const extra = entry.extra as any;
        const target = entry.target as any;

        for (const obj of [extra, target, entry as any]) {
          if (obj?.roles && Array.isArray(obj.roles)) {
            for (const r of obj.roles) {
              if (typeof r === "string") roleIdsRaw.push(r);
              else if (r?.id) roleIdsRaw.push(r.id);
            }
          }
          if (obj?.role_ids && Array.isArray(obj.role_ids)) {
            for (const id of obj.role_ids) {
              if (typeof id === "string") roleIdsRaw.push(id);
            }
          }
        }

        if (roleIdsRaw.length > 0) {
          return [...new Set(roleIdsRaw)];
        }
      }
    } catch {
      // audit log fallback failed
    }

    return [];
  }

  /**
   * Resolve the invite creator from audit log as fallback.
   */
  private async resolveInviteCreator(
    guild: Guild,
    inviteCode: string,
  ): Promise<string | null> {
    try {
      const auditEntries = await this.getCachedInviteCreateAuditEntries(guild);
      for (const entry of auditEntries) {
        if (Date.now() - entry.createdTimestamp > 30_000) continue;

        const codeChange = entry.changes?.find(
          (c: any) => c.key === "code" && c.new === inviteCode,
        );
        if (codeChange) {
          return entry.executorId || entry.executor?.id || null;
        }
      }
    } catch {
      // audit log not accessible
    }

    return null;
  }

  private async getCachedInviteCreateAuditEntries(guild: Guild): Promise<any[]> {
    const now = Date.now();
    const cached = inviteAuditCache.get(guild.id);
    if (cached && now - cached.fetchedAt < INVITE_AUDIT_CACHE_TTL_MS) {
      return cached.entries;
    }

    const pending = pendingInviteAuditFetches.get(guild.id);
    if (pending) return pending;

    const fetchPromise = (async () => {
      const logs = await guild.fetchAuditLogs({
        type: AuditLogEvent.InviteCreate,
        limit: 10,
      }).catch(() => null);
      const entries = logs ? [...logs.entries.values()] : [];
      inviteAuditCache.set(guild.id, { fetchedAt: Date.now(), entries });
      return entries;
    })();

    pendingInviteAuditFetches.set(guild.id, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      pendingInviteAuditFetches.delete(guild.id);
    }
  }

  /**
   * Delete an invite by code.
   */
  private async deleteInvite(guild: Guild, inviteCode: string): Promise<boolean> {
    try {
      const invite = await guild.invites.fetch(inviteCode).catch(() => null);
      if (!invite) {
        // Try direct API delete
        await guild.invites.delete(inviteCode, "[ANTINUKE] Dangerous invite role — deleting invite").catch(() => null);
        return true;
      }

      await invite.delete("[ANTINUKE] Dangerous invite role — deleting invite");
      logger.info(`[ ANTINUKE ] Deleted dangerous invite ${inviteCode} in ${guild.id}`);
      return true;
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Failed to delete invite ${inviteCode}: ${err}`);
      return false;
    }
  }

  /**
   * Punish the invite creator: strip roles + ban.
   */
  private async punishInviteCreator(
    guild: Guild,
    executorId: string,
    existingMember: GuildMember | null,
  ): Promise<void> {
    try {
      const botMember =
        guild.members.me ||
        (await guild.members.fetchMe().catch(() => null));
      if (!botMember) return;

      const member =
        existingMember ||
        (await guild.members.fetch(executorId).catch(() => null));

      // Strip all manageable roles
      if (member && member.manageable) {
        const removableRoles = member.roles.cache.filter(
          (role) =>
            role.id !== guild.id &&
            !role.managed &&
            role.position < botMember.roles.highest.position,
        );

        if (removableRoles.size > 0) {
          await member.roles
            .remove(
              removableRoles,
              "[ANTINUKE] Dangerous invite role — stripping all roles before ban",
            )
            .catch(() => null);
          logger.info(
            `[ ANTINUKE ] Stripped ${removableRoles.size} roles from invite role attacker ${executorId}`,
          );
        }
      }

      // Ban
      await guild.members
        .ban(executorId, {
          reason:
            "[ANTINUKE] Created invite link with dangerous role permissions (Admin/ManageServer/ManageRoles/ManageChannels)",
          deleteMessageSeconds: 0,
        })
        .catch(() => null);

      logger.warn(
        `[ ANTINUKE ] Banned dangerous invite role creator ${executorId} in ${guild.id}`,
      );
    } catch (err) {
      logger.warn(
        `[ ANTINUKE ] Failed to punish invite role creator ${executorId}: ${err}`,
      );
    }
  }

  /**
   * Format the dangerous permissions a role has.
   */
  private formatRolePerms(role: Role): string {
    const permLabels: [bigint, string][] = [
      [PermissionFlagsBits.Administrator, "Administrator"],
      [PermissionFlagsBits.ManageGuild, "Manage Server"],
      [PermissionFlagsBits.ManageRoles, "Manage Roles"],
      [PermissionFlagsBits.ManageChannels, "Manage Channels"],
    ];

    return permLabels
      .filter(([perm]) => role.permissions.has(perm))
      .map(([, label]) => `\`${label}\``)
      .join(", ") || "`None`";
  }

  /**
   * Format dangerous permissions across multiple roles.
   */
  private formatDangerousPerms(roles: Role[]): string {
    const allPerms = new Set<string>();
    const permLabels: [bigint, string][] = [
      [PermissionFlagsBits.Administrator, "Administrator"],
      [PermissionFlagsBits.ManageGuild, "Manage Server"],
      [PermissionFlagsBits.ManageRoles, "Manage Roles"],
      [PermissionFlagsBits.ManageChannels, "Manage Channels"],
    ];

    for (const role of roles) {
      for (const [perm, label] of permLabels) {
        if (role.permissions.has(perm)) allPerms.add(label);
      }
    }

    return [...allPerms].map((p) => `\`${p}\``).join(", ") || "`None`";
  }

  /**
   * DM the server owner about the dangerous invite.
   */
  private async dmOwner(
    guild: Guild,
    executorId: string,
    dangerousRoles: Role[],
    inviteCode: string,
  ): Promise<void> {
    try {
      const owner = await guild.fetchOwner();
      await owner
        .send({
          content: [
            "🚫 **ANTINUKE — Dangerous Invite Role Detected**",
            "",
            `**Server:** ${guild.name}`,
            `**Attacker:** <@${executorId}> (\`${executorId}\`)`,
            `**Invite Code:** \`${inviteCode}\` (deleted ✅)`,
            "",
            `> Someone created an invite link that automatically gives`,
            `> joining users roles with dangerous permissions:`,
            "",
            ...dangerousRoles.map(
              (r) => `> 🔴 **${r.name}** — ${this.formatRolePerms(r)}`,
            ),
            "",
            `**Action Taken:**`,
            `> ✅ Invite deleted`,
            `> ✅ All roles stripped from attacker`,
            `> ✅ Attacker banned`,
            "",
            `**✅ Your server is protected.** Only whitelisted users,`,
            `extra owners, and the server owner can create invites`,
            `with admin-level roles.`,
          ].join("\n"),
        })
        .catch(() => null);
    } catch {
      /* cannot reach owner */
    }
  }
}
