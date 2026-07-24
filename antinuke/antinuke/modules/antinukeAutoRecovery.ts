import { AuditLogEvent, ChannelType, Guild, GuildChannel, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import logger from "../../utils/logger";
import { getAntiNukeConfig } from "../client/antinukeStore";
import { sendIncidentLog } from "../client/antinukeRuntime";

// ── Recovery-in-progress guard ──────────────────────────────────────────────
// Tracks members currently being recovered to prevent re-trigger loops.
// When the bot calls roles.set(), Discord fires a new guildMemberUpdate event.
// Without this guard, the listener would pick up the attacker's still-recent
// audit entry and trigger another recovery, causing a remove→add loop.
const recoveryInProgress = new Set<string>(); // key: `${guildId}:${memberId}`
const RECOVERY_COOLDOWN_MS = 5_000; // keep guard for 5s after recovery completes
const channelRecoveryInProgress = new Set<string>(); // key: `${guildId}:${channelId}`
const CHANNEL_RECOVERY_COOLDOWN_MS = 10_000;
const roleRecoveryInProgress = new Set<string>(); // key: `${guildId}:${roleId}`
const ROLE_RECOVERY_COOLDOWN_MS = 10_000;
const guildRecoveryInProgress = new Set<string>(); // key: guildId
const GUILD_RECOVERY_COOLDOWN_MS = 10_000;

export function isRecoveryInProgress(guildId: string, memberId: string): boolean {
  return recoveryInProgress.has(`${guildId}:${memberId}`);
}

// M6: Short-TTL cache for recent MemberRoleUpdate audit log entries.
// During an attack with 50 rapid role changes, this deduplicates fetchAuditLogs calls.
interface AuditLogCacheEntry {
  entries: Array<{ executorId: string | null; targetId: string | null; changes: any[]; createdTimestamp: number }>;
  fetchedAt: number;
}
const auditLogCache = new Map<string, AuditLogCacheEntry>();
const AUDIT_LOG_CACHE_TTL_MS = 5_000;
const WEBHOOK_CACHE_TTL_MS = 5_000;
const webhookCache = new Map<string, { fetchedAt: number; webhooks: Awaited<ReturnType<Guild["fetchWebhooks"]> > }>();
const pendingWebhookFetches = new Map<string, Promise<Awaited<ReturnType<Guild["fetchWebhooks"]> | null>>>();

// Periodic cleanup for bounded cache sizes (prevents unbounded growth under sustained nuke attacks)
const MAX_AUDIT_CACHE_SIZE = 500;
const MAX_WEBHOOK_CACHE_SIZE = 500;
const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of auditLogCache) {
    if (now - entry.fetchedAt > AUDIT_LOG_CACHE_TTL_MS * 2) auditLogCache.delete(key);
  }
  for (const [key, entry] of webhookCache) {
    if (now - entry.fetchedAt > WEBHOOK_CACHE_TTL_MS * 2) webhookCache.delete(key);
  }
  // Hard cap in case TTL cleanup isn't enough
  if (auditLogCache.size > MAX_AUDIT_CACHE_SIZE) auditLogCache.clear();
  if (webhookCache.size > MAX_WEBHOOK_CACHE_SIZE) webhookCache.clear();
  if (pendingWebhookFetches.size > MAX_WEBHOOK_CACHE_SIZE) pendingWebhookFetches.clear();
}, 30_000);
cacheCleanupTimer.unref();

export async function getCachedMemberRoleAuditLogs(
  guild: Guild,
): Promise<AuditLogCacheEntry["entries"]> {
  const now = Date.now();
  const cached = auditLogCache.get(guild.id);
  if (cached && now - cached.fetchedAt < AUDIT_LOG_CACHE_TTL_MS) {
    return cached.entries;
  }


  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 25 }).catch(() => null);
  if (!logs) return [];

  const entries = [...logs.entries.values()].map((entry) => ({
    executorId: entry.executorId ?? entry.executor?.id ?? null,
    targetId: entry.target?.id ?? null,
    changes: entry.changes ?? [],
    createdTimestamp: entry.createdTimestamp,
  }));

  auditLogCache.set(guild.id, { entries, fetchedAt: now });

  // Auto-cleanup stale cache entries to prevent memory growth.
  if (auditLogCache.size > 200) {
    for (const [key, value] of auditLogCache) {
      if (now - value.fetchedAt > AUDIT_LOG_CACHE_TTL_MS) auditLogCache.delete(key);
    }
  }

  return entries;
}

async function getCachedGuildWebhooks(
  guild: Guild,
): Promise<Awaited<ReturnType<Guild["fetchWebhooks"]>> | null> {
  const now = Date.now();
  const cached = webhookCache.get(guild.id);
  if (cached && now - cached.fetchedAt < WEBHOOK_CACHE_TTL_MS) {
    return cached.webhooks;
  }

  const pending = pendingWebhookFetches.get(guild.id);
  if (pending) return pending;

  const fetchPromise = guild.fetchWebhooks().catch(() => null);
  pendingWebhookFetches.set(guild.id, fetchPromise);

  try {
    const webhooks = await fetchPromise;
    if (webhooks) {
      webhookCache.set(guild.id, { fetchedAt: Date.now(), webhooks });
    }
    return webhooks;
  } finally {
    pendingWebhookFetches.delete(guild.id);
  }
}

export async function isAutoRecoveryEnabled(guildId: string): Promise<boolean> {
  const config = await getAntiNukeConfig(guildId);
  return config?.moduleStates?.autoRecovery !== false;
}

async function fetchAssetBuffer(url: string): Promise<Buffer | null> {
  try {
    // M10: Prevent hanging forever on unresponsive CDN/URLs.
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;

    const data = await response.arrayBuffer();
    return Buffer.from(data);
  } catch {
    return null;
  }
}

export async function restoreUpdatedGuild(oldGuild: Guild, newGuild: Guild): Promise<boolean> {
  const guardKey = newGuild.id;
  if (guildRecoveryInProgress.has(guardKey)) return false;

  const nameChanged = oldGuild.name !== newGuild.name;
  const descriptionChanged = (oldGuild.description ?? null) !== (newGuild.description ?? null);
  const iconChanged = (oldGuild.icon ?? null) !== (newGuild.icon ?? null);
  const bannerChanged = (oldGuild.banner ?? null) !== (newGuild.banner ?? null);
  const splashChanged = (oldGuild.splash ?? null) !== (newGuild.splash ?? null);
  const discoverySplashChanged = (oldGuild.discoverySplash ?? null) !== (newGuild.discoverySplash ?? null);

  if (!nameChanged && !descriptionChanged && !iconChanged && !bannerChanged && !splashChanged && !discoverySplashChanged) return false;

  const me = newGuild.members.me ?? (await newGuild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    logger.warn(`[ ANTINUKE ] AutoRecovery could not restore guild ${newGuild.id}: missing ManageGuild permission.`);
    return false;
  }

  const payload: {
    name?: string;
    description?: string | null;
    icon?: Buffer | null;
    banner?: Buffer | null;
    splash?: Buffer | null;
    discoverySplash?: Buffer | null;
    reason: string;
  } = {
    reason: "[ANTINUKE] AutoRecovery revert unauthorized guild update",
  };

  if (nameChanged) {
    payload.name = oldGuild.name;
  }

  if (descriptionChanged) {
    payload.description = oldGuild.description ?? null;
  }

  if (iconChanged) {
    if (!oldGuild.icon) {
      payload.icon = null;
    } else {
      const iconUrl = oldGuild.iconURL({ extension: "png", size: 1024 });
      if (iconUrl) {
        const iconBuffer = await fetchAssetBuffer(iconUrl);
        if (iconBuffer) {
          payload.icon = iconBuffer;
        } else {
          logger.warn(`[ ANTINUKE ] AutoRecovery could not fetch previous guild icon for ${newGuild.id}.`);
        }
      }
    }
  }

  if (bannerChanged) {
    if (!oldGuild.banner) {
      payload.banner = null;
    } else {
      const bannerUrl = oldGuild.bannerURL({ extension: "png", size: 2048 });
      if (bannerUrl) {
        const bannerBuffer = await fetchAssetBuffer(bannerUrl);
        if (bannerBuffer) {
          payload.banner = bannerBuffer;
        } else {
          logger.warn(`[ ANTINUKE ] AutoRecovery could not fetch previous guild banner for ${newGuild.id}.`);
        }
      }
    }
  }

  if (splashChanged) {
    if (!oldGuild.splash) {
      payload.splash = null;
    } else {
      const splashUrl = oldGuild.splashURL({ extension: "png", size: 2048 });
      if (splashUrl) {
        const splashBuffer = await fetchAssetBuffer(splashUrl);
        if (splashBuffer) {
          payload.splash = splashBuffer;
        } else {
          logger.warn(`[ ANTINUKE ] AutoRecovery could not fetch previous guild splash for ${newGuild.id}.`);
        }
      }
    }
  }

  if (discoverySplashChanged) {
    if (!oldGuild.discoverySplash) {
      payload.discoverySplash = null;
    } else {
      const discoverySplashUrl = oldGuild.discoverySplashURL({ extension: "png", size: 2048 });
      if (discoverySplashUrl) {
        const discoverySplashBuffer = await fetchAssetBuffer(discoverySplashUrl);
        if (discoverySplashBuffer) {
          payload.discoverySplash = discoverySplashBuffer;
        } else {
          logger.warn(`[ ANTINUKE ] AutoRecovery could not fetch previous guild discovery splash for ${newGuild.id}.`);
        }
      }
    }
  }

  if (
    !("name" in payload)
    && !("description" in payload)
    && !("icon" in payload)
    && !("banner" in payload)
    && !("splash" in payload)
    && !("discoverySplash" in payload)
  ) {
    return false;
  }

  guildRecoveryInProgress.add(guardKey);
  try {
    const restored = await newGuild.edit(payload).then(() => true).catch(() => false);
    if (!restored) {
      logger.warn(`[ ANTINUKE ] AutoRecovery failed to restore guild update in ${newGuild.id}.`);
      return false;
    }

    const restoredFields = [
      "name" in payload ? "name" : null,
      "description" in payload ? "description" : null,
      "icon" in payload ? "icon" : null,
      "banner" in payload ? "banner" : null,
      "splash" in payload ? "splash" : null,
      "discoverySplash" in payload ? "discoverySplash" : null,
    ].filter(Boolean).join(", ");

    logger.warn(`[ ANTINUKE ] AutoRecovery restored guild update in ${newGuild.id} (${restoredFields}).`);
    return true;
  } finally {
    setTimeout(() => guildRecoveryInProgress.delete(guardKey), GUILD_RECOVERY_COOLDOWN_MS);
  }
}

function buildChannelOverwritePayload(channel: GuildChannel): Array<{ id: string; allow: bigint; deny: bigint; type: number }> {
  return channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.id,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
    type: overwrite.type,
  }));
}

function serializeChannelOverwrites(channel: GuildChannel): string {
  return channel.permissionOverwrites.cache
    .map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    }))
    .sort((a, b) => {
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      return a.type - b.type;
    })
    .map((value) => `${value.id}:${value.type}:${value.allow}:${value.deny}`)
    .join("|");
}

export async function cleanupUnauthorizedChannel(channel: GuildChannel): Promise<boolean> {
  if (!channel.deletable) return false;

  const deleted = await channel
    .delete("[ANTINUKE] AutoRecovery cleanup unauthorized channel create")
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized channel ${channel.id} (${channel.name}).`);
  }

  return deleted;
}

export async function recoverDeletedChannel(channel: GuildChannel): Promise<boolean> {
  if (channel.isThread()) return false;

  const payload = {
    name: channel.name,
    type: channel.type,
    parent: channel.parentId || undefined,
    permissionOverwrites: buildChannelOverwritePayload(channel),
    topic: (channel as any).topic,
    nsfw: (channel as any).nsfw,
    rateLimitPerUser: (channel as any).rateLimitPerUser,
    bitrate: (channel as any).bitrate,
    userLimit: (channel as any).userLimit,
    rtcRegion: (channel as any).rtcRegion,
    videoQualityMode: (channel as any).videoQualityMode,
    reason: "[ANTINUKE] AutoRecovery recreate deleted channel",
  };

  const recreated = await channel.guild.channels.create(payload as any).catch(() => null);
  if (!recreated) return false;

  if (typeof channel.position === "number") {
    await (recreated as any).setPosition(channel.position).catch(() => null);
  }

  logger.warn(`[ ANTINUKE ] AutoRecovery recreated deleted channel ${channel.id} -> ${recreated.id}.`);
  return true;
}

export async function restoreUpdatedChannel(oldChannel: GuildChannel, newChannel: GuildChannel): Promise<boolean> {
  if (newChannel.type !== oldChannel.type) return false;
  if (!newChannel.manageable) return false;
  const guardKey = `${newChannel.guild.id}:${newChannel.id}`;
  if (channelRecoveryInProgress.has(guardKey)) return false;

  const hasRestorableDiff = (
    oldChannel.name !== newChannel.name
    || (oldChannel.parentId ?? null) !== (newChannel.parentId ?? null)
    || ((oldChannel as any).topic ?? null) !== ((newChannel as any).topic ?? null)
    || ((oldChannel as any).nsfw ?? null) !== ((newChannel as any).nsfw ?? null)
    || ((oldChannel as any).rateLimitPerUser ?? null) !== ((newChannel as any).rateLimitPerUser ?? null)
    || ((oldChannel as any).bitrate ?? null) !== ((newChannel as any).bitrate ?? null)
    || ((oldChannel as any).userLimit ?? null) !== ((newChannel as any).userLimit ?? null)
    || ((oldChannel as any).rtcRegion ?? null) !== ((newChannel as any).rtcRegion ?? null)
    || ((oldChannel as any).videoQualityMode ?? null) !== ((newChannel as any).videoQualityMode ?? null)
    || (typeof oldChannel.position === "number" && typeof newChannel.position === "number" && oldChannel.position !== newChannel.position)
    || serializeChannelOverwrites(oldChannel) !== serializeChannelOverwrites(newChannel)
  );
  if (!hasRestorableDiff) return false;

  const editPayload = {
    name: oldChannel.name,
    parent: oldChannel.parentId || null,
    topic: (oldChannel as any).topic,
    nsfw: (oldChannel as any).nsfw,
    rateLimitPerUser: (oldChannel as any).rateLimitPerUser,
    bitrate: (oldChannel as any).bitrate,
    userLimit: (oldChannel as any).userLimit,
    rtcRegion: (oldChannel as any).rtcRegion,
    videoQualityMode: (oldChannel as any).videoQualityMode,
    permissionOverwrites: buildChannelOverwritePayload(oldChannel),
    reason: "[ANTINUKE] AutoRecovery revert unauthorized channel update",
  };

  channelRecoveryInProgress.add(guardKey);
  try {
    const reverted = await newChannel.edit(editPayload as any).then(() => true).catch(() => false);
    if (!reverted) return false;

    if (typeof oldChannel.position === "number") {
      await newChannel.setPosition(oldChannel.position).catch(() => null);
    }

    logger.warn(`[ ANTINUKE ] AutoRecovery reverted channel update ${newChannel.id}.`);
    return true;
  } finally {
    setTimeout(() => channelRecoveryInProgress.delete(guardKey), CHANNEL_RECOVERY_COOLDOWN_MS);
  }
}

export async function cleanupUnauthorizedRole(role: Role): Promise<boolean> {
  if (!role.editable) return false;

  const deleted = await role
    .delete("[ANTINUKE] AutoRecovery cleanup unauthorized role create")
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized role ${role.id} (${role.name}).`);
  }

  return deleted;
}

export interface RoleRecoveryResult {
  recovered: boolean;
  recreatedRoleId?: string;
  details: string;
}

export async function recoverDeletedRole(role: Role): Promise<RoleRecoveryResult> {
  const me = role.guild.members.me ?? (await role.guild.members.fetchMe().catch(() => null));
  if (!me) {
    return {
      recovered: false,
      details: "Recovery failed: bot member is not available in guild cache.",
    };
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return {
      recovered: false,
      details: "Recovery failed: missing `ManageRoles` permission.",
    };
  }

  let recreated: Role | null = null;
  try {
    recreated = await role.guild.roles.create({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield,
      reason: "[ANTINUKE] AutoRecovery recreate deleted role",
    });
  } catch (err) {
    return {
      recovered: false,
      details: `Recovery failed while creating role: ${String(err)}`,
    };
  }

  if (!recreated) {
    return {
      recovered: false,
      details: "Recovery failed: role creation returned no role object.",
    };
  }

  const maxManageablePosition = Math.max(1, me.roles.highest.position - 1);
  const targetPosition = Math.min(role.position, maxManageablePosition);

  try {
    await recreated.setPosition(targetPosition);
  } catch (err) {
    logger.warn(
      `[ ANTINUKE ] AutoRecovery recreated role ${role.id} -> ${recreated.id}, but failed to set position ${role.position}: ${err}`,
    );
    return {
      recovered: true,
      recreatedRoleId: recreated.id,
      details: `Recovered deleted role **${role.name}** as <@&${recreated.id}>, but position restore failed (requested: ${role.position}, applied: ${recreated.position}).`,
    };
  }

  if (targetPosition !== role.position) {
    logger.warn(
      `[ ANTINUKE ] AutoRecovery recreated role ${role.id} -> ${recreated.id} with clamped position ${targetPosition} (original ${role.position}) due to hierarchy.`,
    );
    return {
      recovered: true,
      recreatedRoleId: recreated.id,
      details: `Recovered deleted role **${role.name}** as <@&${recreated.id}> with limited position (${targetPosition}) due to role hierarchy.`,
    };
  }

  logger.warn(`[ ANTINUKE ] AutoRecovery recreated deleted role ${role.id} -> ${recreated.id}.`);
  return {
    recovered: true,
    recreatedRoleId: recreated.id,
    details: `Recovered deleted role **${role.name}** as <@&${recreated.id}> with original position restored.`,
  };
}

export async function restoreUpdatedRole(oldRole: Role, newRole: Role): Promise<boolean> {
  if (!newRole.editable) return false;
  const guardKey = `${newRole.guild.id}:${newRole.id}`;
  if (roleRecoveryInProgress.has(guardKey)) return false;

  const hasRestorableDiff = (
    oldRole.name !== newRole.name
    || oldRole.color !== newRole.color
    || oldRole.hoist !== newRole.hoist
    || oldRole.mentionable !== newRole.mentionable
    || oldRole.permissions.bitfield !== newRole.permissions.bitfield
    || oldRole.position !== newRole.position
  );
  if (!hasRestorableDiff) return false;

  roleRecoveryInProgress.add(guardKey);
  try {
    const reverted = await newRole.edit({
      name: oldRole.name,
      color: oldRole.color,
      hoist: oldRole.hoist,
      mentionable: oldRole.mentionable,
      permissions: oldRole.permissions.bitfield,
      reason: "[ANTINUKE] AutoRecovery revert unauthorized role update",
    }).then(() => true).catch(() => false);

    if (!reverted) return false;

    await newRole.setPosition(oldRole.position).catch(() => null);
    logger.warn(`[ ANTINUKE ] AutoRecovery reverted role update ${newRole.id}.`);
    return true;
  } finally {
    setTimeout(() => roleRecoveryInProgress.delete(guardKey), ROLE_RECOVERY_COOLDOWN_MS);
  }
}

export async function restoreMemberRoles(oldMember: GuildMember, newMember: GuildMember): Promise<boolean> {
  const me = newMember.guild.members.me ?? (await newMember.guild.members.fetchMe().catch(() => null));
  if (!me) return false;

  const currentRoleIds = new Set(newMember.roles.cache.map((role) => role.id));
  let desiredRoleIds = new Set(oldMember.roles.cache.map((role) => role.id));

  // Reverse recent audit role changes to recover the state before the attack burst.
  // M6: Uses cached audit logs to deduplicate fetch calls during rapid attack bursts.
  try {
    const auditEntries = await getCachedMemberRoleAuditLogs(newMember.guild);

    const recent = auditEntries
      .filter((entry) => (
        Date.now() - entry.createdTimestamp < 30_000
        && entry.targetId === newMember.id
      ))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (recent.length > 0) {
      const reconstructed = new Set(currentRoleIds);

      for (const entry of recent) {
        if (!entry.changes) continue;

        for (const change of entry.changes) {
          if (change.key === "$add" && Array.isArray(change.new)) {
            for (const role of (change.new as { id: string }[])) {
              reconstructed.delete(role.id);
            }
          }

          if (change.key === "$remove" && Array.isArray(change.old)) {
            for (const role of (change.old as { id: string }[])) {
              reconstructed.add(role.id);
            }
          }
        }
      }

      desiredRoleIds = reconstructed;
    }
  } catch (err) {
    logger.debug(`[ ANTINUKE ] AutoRecovery memberRoleUpdate audit reconstruction failed: ${err}`);
  }

  const preservedUntouchableRoles = newMember.roles.cache
    .filter((role) => (
      role.id === newMember.guild.id
      || role.managed
      || role.position >= me.roles.highest.position
    ))
    .map((role) => role.id);

  const manageableDesiredRoles = [...desiredRoleIds]
    .map((id) => newMember.guild.roles.cache.get(id))
    .filter((role): role is Role => Boolean(
      role
      && role.id !== newMember.guild.id
      && !role.managed
      && role.position < me.roles.highest.position
    ))
    .map((role) => role.id);

  let targetRoleIds = [...new Set([
    newMember.guild.id,
    ...preservedUntouchableRoles,
    ...manageableDesiredRoles,
  ])];

  let targetRoleSet = new Set(targetRoleIds);
  let removedCount = [...currentRoleIds]
    .filter((id) => !targetRoleSet.has(id))
    .filter((id) => {
      const role = newMember.guild.roles.cache.get(id);
      return Boolean(role && role.id !== newMember.guild.id && !role.managed && role.position < me.roles.highest.position);
    }).length;

  let addedCount = [...targetRoleSet]
    .filter((id) => !currentRoleIds.has(id))
    .filter((id) => {
      const role = newMember.guild.roles.cache.get(id);
      return Boolean(role && role.id !== newMember.guild.id && !role.managed && role.position < me.roles.highest.position);
    }).length;

  if (removedCount === 0 && addedCount === 0) {
    // Fallback: enforce direct old->new snapshot rollback if audit reconstruction produced no diff.
    const fallbackDesiredRoles = oldMember.roles.cache
      .filter((role) => (
        role.id !== newMember.guild.id
        && !role.managed
        && role.position < me.roles.highest.position
      ))
      .map((role) => role.id);

    const fallbackTargetRoleIds = [...new Set([
      newMember.guild.id,
      ...preservedUntouchableRoles,
      ...fallbackDesiredRoles,
    ])];

    const fallbackTargetRoleSet = new Set(fallbackTargetRoleIds);
    const fallbackRemovedCount = [...currentRoleIds]
      .filter((id) => !fallbackTargetRoleSet.has(id))
      .filter((id) => {
        const role = newMember.guild.roles.cache.get(id);
        return Boolean(role && role.id !== newMember.guild.id && !role.managed && role.position < me.roles.highest.position);
      }).length;

    const fallbackAddedCount = [...fallbackTargetRoleSet]
      .filter((id) => !currentRoleIds.has(id))
      .filter((id) => {
        const role = newMember.guild.roles.cache.get(id);
        return Boolean(role && role.id !== newMember.guild.id && !role.managed && role.position < me.roles.highest.position);
      }).length;

    if (fallbackRemovedCount === 0 && fallbackAddedCount === 0) {
      logger.warn(`[ ANTINUKE ] AutoRecovery found no manageable member-role changes to revert for ${newMember.user.tag}.`);
      return false;
    }

    targetRoleIds = fallbackTargetRoleIds;
    targetRoleSet = fallbackTargetRoleSet;
    removedCount = fallbackRemovedCount;
    addedCount = fallbackAddedCount;
  }

  const guardKey = `${newMember.guild.id}:${newMember.id}`;
  recoveryInProgress.add(guardKey);

  try {
    await newMember.roles.set(targetRoleIds, "[ANTINUKE] AutoRecovery restore previous role state");
    logger.warn(`[ ANTINUKE ] AutoRecovery restored exact role state for ${newMember.user.tag} (Removed: ${removedCount}, Added: ${addedCount}).`);
    return true;
  } catch (err) {
    logger.warn(`[ ANTINUKE ] AutoRecovery failed to restore exact role state for ${newMember.user.tag}: ${err}`);
    return false;
  } finally {
    // Keep the guard active for a few seconds to absorb propagated guildMemberUpdate events.
    setTimeout(() => recoveryInProgress.delete(guardKey), RECOVERY_COOLDOWN_MS);
  }
}

// ── Emoji / Sticker / Webhook auto-recovery helpers ─────────────────────────

/**
 * Delete an unauthorized emoji created by a punished executor.
 */
export async function cleanupUnauthorizedEmoji(emoji: import("discord.js").GuildEmoji): Promise<boolean> {
  if (!emoji.deletable) return false;

  const deleted = await emoji
    .delete("[ANTINUKE] AutoRecovery cleanup unauthorized emoji create")
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized emoji ${emoji.id} (:${emoji.name}:).`);
  }

  return deleted;
}

/**
 * Delete an unauthorized sticker created by a punished executor.
 */
export async function cleanupUnauthorizedSticker(sticker: import("discord.js").Sticker): Promise<boolean> {
  const deleted = await sticker
    .delete("[ANTINUKE] AutoRecovery cleanup unauthorized sticker create")
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized sticker ${sticker.id} (${sticker.name}).`);
  }

  return deleted;
}

export async function recoverDeletedEmoji(emoji: import("discord.js").GuildEmoji): Promise<boolean> {
  if (!emoji.url || !emoji.name) return false;
  const recreated = await emoji.guild.emojis.create({ attachment: emoji.url, name: emoji.name, reason: "[ANTINUKE] AutoRecovery recreate deleted emoji" }).catch(() => null);
  if (!recreated) return false;
  logger.warn(`[ ANTINUKE ] AutoRecovery recreated deleted emoji ${emoji.id} -> ${recreated.id}.`);
  return true;
}

export async function recoverDeletedSticker(sticker: import("discord.js").Sticker): Promise<boolean> {
  if (!sticker.url || !sticker.name || !sticker.tags) return false;
  const recreated = await sticker.guild?.stickers.create({ file: sticker.url, name: sticker.name, tags: sticker.tags, description: sticker.description ?? "", reason: "[ANTINUKE] AutoRecovery recreate deleted sticker" }).catch(() => null);
  if (!recreated) return false;
  logger.warn(`[ ANTINUKE ] AutoRecovery recreated deleted sticker ${sticker.id} -> ${recreated.id}.`);
  return true;
}

export async function recoverDeletedAutoModRule(rule: import("discord.js").AutoModerationRule): Promise<boolean> {
  const recreated = await rule.guild.autoModerationRules.create({
    name: rule.name,
    eventType: rule.eventType,
    triggerType: rule.triggerType,
    triggerMetadata: rule.triggerMetadata as any,
    actions: rule.actions as any,
    enabled: rule.enabled,
    exemptRoles: [...rule.exemptRoles.keys()] as any,
    exemptChannels: [...rule.exemptChannels.keys()] as any,
    reason: "[ANTINUKE] AutoRecovery recreate deleted AutoModeration rule",
  }).catch(() => null);
  if (!recreated) return false;
  logger.warn(`[ ANTINUKE ] AutoRecovery recreated deleted AutoMod rule ${rule.name}.`);
  return true;
}

/**
 * Delete an unauthorized soundboard sound created by a punished executor.
 */
export async function cleanupUnauthorizedSoundboardSound(sound: import("discord.js").SoundboardSound): Promise<boolean> {
  const deleted = await sound
    .delete("[ANTINUKE] AutoRecovery cleanup unauthorized soundboard sound create")
    .then(() => true)
    .catch(() => false);

  if (deleted) {
    const soundId = (sound as any).id || (sound as any).soundId;
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized soundboard sound ${soundId} (${sound.name}).`);
  }

  return deleted;
}

/**
 * Delete an unauthorized webhook identified from audit logs.
 * Accepts a Guild + the audit log target (webhook object).
 */
export async function cleanupUnauthorizedWebhook(
  guild: Guild,
  webhookId: string,
): Promise<boolean> {
  try {
    const webhooks = await getCachedGuildWebhooks(guild);
    if (!webhooks) return false;

    const webhook = webhooks.get(webhookId);
    if (!webhook) return false;

    await webhook.delete("[ANTINUKE] AutoRecovery cleanup unauthorized webhook");
    const cached = webhookCache.get(guild.id);
    if (cached) {
      cached.webhooks.delete(webhookId);
      webhookCache.set(guild.id, cached);
    }
    logger.warn(`[ ANTINUKE ] AutoRecovery removed unauthorized webhook ${webhookId} (${webhook.name}).`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a recovery report to the configured AntiNuke log channel.
 * Called by event listeners after auto-recovery actions complete.
 */
export async function sendRecoveryReport(
  guild: Guild,
  recoveryType: string,
  details: string,
): Promise<void> {
  const config = await getAntiNukeConfig(guild.id);
  if (!config?.logChannelId) return;

  await sendIncidentLog(
    guild,
    config.logChannelId,
    "AutoRecovery Report",
    [
      `**Recovery Type:** ${recoveryType}`,
      `**Details:** ${details}`,
    ].join("\n"),
  );
}
