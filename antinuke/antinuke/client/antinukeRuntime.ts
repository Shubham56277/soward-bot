import { AuditLogEvent, Guild, GuildAuditLogsResolvable, GuildMember, PermissionFlagsBits, PermissionsBitField, TextBasedChannel, WebhookClient } from "discord.js";
import { V2, V2_FLAGS } from "../../ui";
import { EmbedColors } from "../../utils/colors";
import { Bot } from "../../core/client";
import {
  ANTINUKE_PROTECTED_ACTIONS,
  AntiNukeAction,
  AntiNukePunishment,
  AntiNukeTierName,
  AntiNukeWhitelistAccessProfile,
  addAntiNukeIncident,
  addAntiNukeAudit,
  countAntiNukeIncidentsSince,
  getAntiNukeConfig,
  updateAntiNukeConfig,
} from "./antinukeStore";
import { isGuildPremiumActive } from "../../utils/premiumGuard";
import { getPanicConfigFromAntiNuke, quarantineMember } from "../../utils/panicModeStore";
import { enforcePanicMode } from "../../utils/panicModeEnforcer";
import logger from "../../utils/logger";
import { pauseGuildQueue } from "../../utils/roleQueue";
import { LRUCache } from "lru-cache";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory counters
// ─────────────────────────────────────────────────────────────────────────────

interface ActionCounter {
  timestamps: number[];
}

const ACTION_COUNTERS_MAX = 250_000;
const ACTION_COUNTERS_TTL_MS = 30 * 60_000;
const PUNISHMENT_COOLDOWN_MAX = 100_000;
const PUNISHMENT_COOLDOWN_TTL_MS = 2 * 60_000;
const AEGIS_COUNTERS_MAX = 100_000;
const AEGIS_COUNTERS_TTL_MS = 2 * 60_000;
const MULTI_TRIGGER_MAX = 100_000;
const MULTI_TRIGGER_TTL_MS = 2 * 60_000;
const WHITELIST_COUNTERS_MAX = 250_000;
const WHITELIST_COUNTERS_TTL_MS = 65 * 60_000;
const PREMIUM_STATUS_CACHE_TTL_MS = 10_000;
const ANTINUKE_CONFIG_CACHE_TTL_MS = 10_000;

/** key: `${guildId}:${executorId}:${action}` */
const actionCounters = new LRUCache<string, ActionCounter>({
  max: ACTION_COUNTERS_MAX,
  ttl: ACTION_COUNTERS_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
/** key: `${guildId}:${executorId}` → cooldown expiry timestamp */
const punishmentCooldown = new LRUCache<string, number>({
  max: PUNISHMENT_COOLDOWN_MAX,
  ttl: PUNISHMENT_COOLDOWN_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
type AegisCounterState = {
  memberLossTimestamps: number[];
  channelDeleteTimestamps: number[];
  roleMutationTimestamps: number[];
  mentionBurstTimestamps: number[];
};
/** key: `${guildId}:${executorId}` */
const aegisCounters = new LRUCache<string, AegisCounterState>({
  max: AEGIS_COUNTERS_MAX,
  ttl: AEGIS_COUNTERS_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
/** key: `${guildId}:${executorId}` */
const aegisCooldown = new LRUCache<string, number>({
  max: AEGIS_COUNTERS_MAX,
  ttl: AEGIS_COUNTERS_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});

/**
 * Tracks the recently-triggered action types per user within a 30-second window.
 * key: `${guildId}:${executorId}` → Set<AntiNukeAction>
 */
const recentMultiModuleTriggers = new LRUCache<string, { actions: Set<AntiNukeAction>; firstAt: number }>({
  max: MULTI_TRIGGER_MAX,
  ttl: MULTI_TRIGGER_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});

/** Tracks whitelist actions per user. key: `${guildId}:${executorId}` → timestamps */
const actionCountersWhitelist = new LRUCache<string, number[]>({
  max: WHITELIST_COUNTERS_MAX,
  ttl: WHITELIST_COUNTERS_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});

/** Tracks tier-specific whitelist actions per user. key: `${guildId}:${executorId}:${scope}:${tier}` → timestamps */
const actionCountersTierWhitelist = new LRUCache<string, number[]>({
  max: WHITELIST_COUNTERS_MAX,
  ttl: WHITELIST_COUNTERS_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
const EXECUTOR_MEMBER_CACHE_MAX = 50_000;
const EXECUTOR_MEMBER_CACHE_TTL_MS = 300_000; // 5 minutes (increased from 5s to avoid rate limits)
const executorMemberCache = new LRUCache<string, GuildMember>({
  max: EXECUTOR_MEMBER_CACHE_MAX,
  ttl: EXECUTOR_MEMBER_CACHE_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
const premiumStatusCache = new LRUCache<string, boolean>({
  max: 50_000,
  ttl: PREMIUM_STATUS_CACHE_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
type CachedConfigEntry = { config: Awaited<ReturnType<typeof getAntiNukeConfig>> | null };
const antiNukeConfigCache = new LRUCache<string, CachedConfigEntry>({
  max: 50_000,
  ttl: ANTINUKE_CONFIG_CACHE_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});

const ANTINUKE_PROTECTED_ACTIONS_SET = new Set<AntiNukeAction>(ANTINUKE_PROTECTED_ACTIONS);

const TIER_DEFAULT_LIMITS: Record<AntiNukeTierName, { threshold: number; window: number }> = {
  staff: { threshold: 3, window: 60 },
  mod: { threshold: 6, window: 60 },
  admin: { threshold: 12, window: 60 },
};

/** Periodic cleanup to prevent memory leaks from stale action counters. */
export function startAntiNukeCounterCleanup(
  registerInterval: (fn: () => void, ms: number) => void,
): void {
  registerInterval(() => {
    const now = Date.now();
    const staleThreshold = 60_000;

    actionCounters.purgeStale();
    punishmentCooldown.purgeStale();
    aegisCounters.purgeStale();
    aegisCooldown.purgeStale();
    recentMultiModuleTriggers.purgeStale();
    actionCountersWhitelist.purgeStale();
    actionCountersTierWhitelist.purgeStale();
    auditLogCache.purgeStale();
    pendingAuditFetches.purgeStale();

    for (const [key, counter] of actionCounters) {
      // Binary search for stale cutoff — timestamps are sorted chronologically
      const cutoff = now - staleThreshold;
      let lo = 0, hi = counter.timestamps.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (counter.timestamps[mid] < cutoff) lo = mid + 1;
        else hi = mid;
      }
      if (lo >= counter.timestamps.length) {
        actionCounters.delete(key);
      } else if (lo > 0) {
        counter.timestamps.splice(0, lo);
      }
    }

    for (const [key, expiresAt] of punishmentCooldown) {
      if (now >= expiresAt) punishmentCooldown.delete(key);
    }
    for (const [key, expiresAt] of aegisCooldown) {
      if (now >= expiresAt) aegisCooldown.delete(key);
    }

    for (const [key, entry] of recentMultiModuleTriggers) {
      if (now - entry.firstAt > 30_000) recentMultiModuleTriggers.delete(key);
    }

    for (const [key, timestamps] of actionCountersWhitelist) {
      // Binary search for whitelist window cutoff
      const cutoff = now - 60_000 * 60;
      let lo = 0, hi = timestamps.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (timestamps[mid] < cutoff) lo = mid + 1;
        else hi = mid;
      }
      if (lo >= timestamps.length) {
        actionCountersWhitelist.delete(key);
      } else if (lo > 0) {
        timestamps.splice(0, lo);
      }
    }

    for (const [key, timestamps] of actionCountersTierWhitelist) {
      // Tier windows are capped at 1 hour.
      const cutoff = now - 60_000 * 60;
      let lo = 0, hi = timestamps.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (timestamps[mid] < cutoff) lo = mid + 1;
        else hi = mid;
      }
      if (lo >= timestamps.length) {
        actionCountersTierWhitelist.delete(key);
      } else if (lo > 0) {
        timestamps.splice(0, lo);
      }
    }

    // Cleanup stale audit log cache entries (>30s old)
    for (const [guildId, entry] of auditLogCache) {
      if (now - entry.fetchedAt > 30_000) auditLogCache.delete(guildId);
    }
  }, 5 * 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Module key map (mirrors antinuke.command.ts SECURITY_MODULE_DEFINITIONS)
// ─────────────────────────────────────────────────────────────────────────────

const SECURITY_MODULE_MAP: { key: string; action?: AntiNukeAction }[] = [
  { key: "antiBan", action: "banAdd" },
  { key: "antiUnban", action: "banRemove" },
  { key: "antiKick", action: "memberKick" },
  { key: "antiBot", action: "botAdd" },
  { key: "antiChannelCreate", action: "channelCreate" },
  { key: "antiChannelDelete", action: "channelDelete" },
  { key: "antiChannelUpdate", action: "channelUpdate" },
  { key: "antiEmojiStickerCreate", action: "emojiStickerCreate" },
  { key: "antiEmojiStickerDelete", action: "emojiStickerDelete" },
  { key: "antiEmojiStickerUpdate", action: "emojiStickerUpdate" },
  { key: "antiSoundboardCreate", action: "soundboardCreate" },
  { key: "antiSoundboardDelete", action: "soundboardDelete" },
  { key: "antiSoundboardUpdate", action: "soundboardUpdate" },
  { key: "antiEveryoneHerePing", action: "everyoneHerePing" },
  { key: "antiLinkRole", action: "linkRole" },
  { key: "antiRoleCreate", action: "roleCreate" },
  { key: "antiRoleDelete", action: "roleDelete" },
  { key: "antiRoleUpdate", action: "roleUpdate" },
  { key: "antiRolePing", action: "rolePing" },
  { key: "antiMemberUpdate", action: "memberRoleUpdate" },
  { key: "antiIntegration", action: "integrationUpdate" },
  { key: "antiServerUpdate", action: "guildUpdate" },
  { key: "antiVanity", action: "vanityUpdate" },
  { key: "antiAutomodRuleCreate", action: "autoModerationRuleCreate" },
  { key: "antiAutomodRuleUpdate", action: "autoModerationRuleUpdate" },
  { key: "antiAutomodRuleDelete", action: "autoModerationRuleDelete" },
  { key: "antiGuildEventCreate", action: "guildScheduledEventCreate" },
  { key: "antiGuildEventUpdate", action: "guildScheduledEventUpdate" },
  { key: "antiGuildEventDelete", action: "guildScheduledEventDelete" },
  { key: "antiWebhook", action: "webhookUpdate" },
  { key: "antiPrune", action: "memberPrune" },
  { key: "autoRecovery", action: "autoRecovery" },
];

const ACTION_MODULE_KEY_MAP: Record<AntiNukeAction, string> = {} as Record<AntiNukeAction, string>;
for (const entry of SECURITY_MODULE_MAP) {
  if (entry.action) ACTION_MODULE_KEY_MAP[entry.action] = entry.key;
}

const ACTION_LABELS: Partial<Record<AntiNukeAction, string>> = {
  banAdd: "Member Banned",
  banRemove: "Member Unbanned",
  memberKick: "Member Kicked",
  memberPrune: "Member Prune",
  channelCreate: "Channel Created",
  channelDelete: "Channel Deleted",
  channelUpdate: "Channel Updated",
  roleCreate: "Role Created",
  roleDelete: "Role Deleted",
  roleUpdate: "Role Updated",
  linkRole: "Role Permission Escalated",
  memberRoleUpdate: "Member Role Updated",
  webhookUpdate: "Webhook Modified",
  integrationUpdate: "Integration Updated",
  guildUpdate: "Server Updated",
  vanityUpdate: "Vanity URL Changed",
  botAdd: "Bot Added",
  everyoneHerePing: "Mass Ping (@everyone/@here)",
  rolePing: "Role Ping",
  emojiStickerCreate: "Emoji/Sticker Created",
  emojiStickerDelete: "Emoji/Sticker Deleted",
  emojiStickerUpdate: "Emoji/Sticker Updated",
  soundboardCreate: "Soundboard Sound Created",
  soundboardDelete: "Soundboard Sound Deleted",
  soundboardUpdate: "Soundboard Sound Updated",
  autoModerationRuleCreate: "AutoMod Rule Created",
  autoModerationRuleUpdate: "AutoMod Rule Updated",
  autoModerationRuleDelete: "AutoMod Rule Deleted",
  guildScheduledEventCreate: "Guild Event Created",
  guildScheduledEventUpdate: "Guild Event Updated",
  guildScheduledEventDelete: "Guild Event Deleted",
  autoRecovery: "Auto Recovery",
};

const ACTION_EMOJIS: Partial<Record<AntiNukeAction, string>> = {
  banAdd: "🔨", banRemove: "🔓", memberKick: "👢", memberPrune: "✂️",
  channelCreate: "📢", channelDelete: "🗑️", channelUpdate: "✏️",
  roleCreate: "🏷️", roleDelete: "♻️", roleUpdate: "🔄", linkRole: "⚠️",
  memberRoleUpdate: "👤", webhookUpdate: "🪝", integrationUpdate: "🔌",
  guildUpdate: "🏠", vanityUpdate: "🔗", botAdd: "🤖",
  everyoneHerePing: "📣", rolePing: "📢",
  emojiStickerCreate: "🖼️", emojiStickerDelete: "🗑️", emojiStickerUpdate: "✏️",
  soundboardCreate: "🎵", soundboardDelete: "🗑️", soundboardUpdate: "✏️",
  autoModerationRuleCreate: "🛡️", autoModerationRuleUpdate: "🛡️", autoModerationRuleDelete: "❌",
  guildScheduledEventCreate: "📅", guildScheduledEventUpdate: "📅", guildScheduledEventDelete: "🗑️",
  autoRecovery: "🔁",
};

// ─────────────────────────────────────────────────────────────────────────────
// Audit log helpers — with guild-level deduplication cache
// ─────────────────────────────────────────────────────────────────────────────

function getAuditType(action: AntiNukeAction): GuildAuditLogsResolvable {
  switch (action) {
    case "banAdd": return AuditLogEvent.MemberBanAdd;
    case "banRemove": return AuditLogEvent.MemberBanRemove;
    case "memberKick": return AuditLogEvent.MemberKick;
    case "memberPrune": return AuditLogEvent.MemberPrune;
    case "channelCreate": return AuditLogEvent.ChannelCreate;
    case "channelDelete": return AuditLogEvent.ChannelDelete;
    case "channelUpdate": return AuditLogEvent.ChannelUpdate;
    case "emojiStickerCreate": return AuditLogEvent.EmojiCreate;
    case "emojiStickerDelete": return AuditLogEvent.EmojiDelete;
    case "emojiStickerUpdate": return AuditLogEvent.EmojiUpdate;
    case "soundboardCreate": return AuditLogEvent.SoundboardSoundCreate;
    case "soundboardDelete": return AuditLogEvent.SoundboardSoundDelete;
    case "soundboardUpdate": return AuditLogEvent.SoundboardSoundUpdate;
    case "everyoneHerePing": return AuditLogEvent.MessageDelete;
    case "linkRole": return AuditLogEvent.RoleUpdate;
    case "roleCreate": return AuditLogEvent.RoleCreate;
    case "roleUpdate": return AuditLogEvent.RoleUpdate;
    case "roleDelete": return AuditLogEvent.RoleDelete;
    case "rolePing": return AuditLogEvent.MessageDelete;
    case "memberRoleUpdate": return AuditLogEvent.MemberRoleUpdate;
    case "integrationUpdate": return AuditLogEvent.IntegrationUpdate;
    case "autoModerationRuleCreate": return AuditLogEvent.AutoModerationRuleCreate;
    case "autoModerationRuleUpdate": return AuditLogEvent.AutoModerationRuleUpdate;
    case "autoModerationRuleDelete": return AuditLogEvent.AutoModerationRuleDelete;
    case "guildScheduledEventCreate": return AuditLogEvent.GuildScheduledEventCreate;
    case "guildScheduledEventUpdate": return AuditLogEvent.GuildScheduledEventUpdate;
    case "guildScheduledEventDelete": return AuditLogEvent.GuildScheduledEventDelete;
    case "webhookUpdate": return AuditLogEvent.WebhookUpdate;
    case "autoRecovery": return AuditLogEvent.GuildUpdate;
    case "botAdd": return AuditLogEvent.BotAdd;
    case "guildUpdate": return AuditLogEvent.GuildUpdate;
    case "vanityUpdate": return AuditLogEvent.GuildUpdate;
    default: return AuditLogEvent.GuildUpdate;
  }
}

interface RunAntiNukeOptions {
  executorId?: string;
  auditType?: GuildAuditLogsResolvable;
  auditTypes?: GuildAuditLogsResolvable[];
  targetId?: string;
}

export interface AntiNukeProtectionResult {
  enforced: boolean;
  enforcedNow: boolean;
  cooldownOnly: boolean;
}

export interface AntiNukeActionEvaluation {
  shouldEnforce: boolean;
  executorId: string | null;
  executorMember: GuildMember | null;
  config: Awaited<ReturnType<typeof getAntiNukeConfig>> | null;
  isWhitelistViolation?: boolean;
  whitelistViolationReason?: string;
  whitelistLimitThreshold?: number;
  whitelistLimitWindow?: number;
}

// ── Audit Log Cache — eliminates redundant API calls during nuke attacks ──
// During a nuke, 5+ different events fire in < 5s for the same guild.
// Previously each one called guild.fetchAuditLogs() independently → 15+ API calls.
// Now: 1 fetch per guild per 5s, shared across all listeners.
interface AuditLogCacheEntry {
  entries: Array<{
    executorId: string;
    type: number;
    createdTimestamp: number;
    targetId?: string;
  }>;
  fetchedAt: number;
}

const AUDIT_CACHE_TTL_MS = 5_000;
const auditLogCache = new LRUCache<string, AuditLogCacheEntry>({
  max: 25_000, // Increased from 10K — supports 20K guilds with headroom
  ttl: AUDIT_CACHE_TTL_MS,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
const pendingAuditFetches = new LRUCache<string, Promise<void>>({
  max: 25_000, // Increased from 10K — supports 20K guilds
  ttl: 10_000,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});

// ── Audit Log Fetch Rate Limiter ──
// Discord's audit log endpoint has strict per-guild rate limits (~1 req/5s).
// This prevents fetch storms when multiple events fire for the same guild.
const auditLogLastFetchAt = new LRUCache<string, number>({
  max: 25_000,
  ttl: 30_000,
  ttlAutopurge: false,
  updateAgeOnGet: false,
});
const AUDIT_LOG_MIN_SPACING_MS = 4_500; // Minimum 4.5s between fetches per guild

/** Fetch audit logs for a guild, or return cached result if fresh (<5s). */
async function ensureAuditLogsCached(guild: Guild): Promise<AuditLogCacheEntry> {
  const cacheKey = guild.id;
  const cached = auditLogCache.get(cacheKey);

  // Cache hit — return immediately
  if (cached && Date.now() - cached.fetchedAt < AUDIT_CACHE_TTL_MS) {
    return cached;
  }

  // Dedup: if another listener already triggered a fetch for this guild, await it
  const pending = pendingAuditFetches.get(cacheKey);
  if (pending) {
    await pending;
    return auditLogCache.get(cacheKey) || { entries: [], fetchedAt: Date.now() };
  }

  // Rate limit guard: enforce minimum spacing between fetches per guild
  // Discord's audit log endpoint has strict per-guild rate limits (~1 req/5s)
  const lastFetch = auditLogLastFetchAt.get(cacheKey);
  const now = Date.now();
  if (lastFetch && now - lastFetch < AUDIT_LOG_MIN_SPACING_MS) {
    // Return stale cache or empty result rather than hitting rate limit
    return cached || { entries: [], fetchedAt: now };
  }

  // Fetch fresh audit logs — single API call covers all action types
  const fetchPromise = (async () => {
    try {
      auditLogLastFetchAt.set(cacheKey, Date.now());
      const logs = await guild.fetchAuditLogs({ limit: 15 });
      const fetchedAt = Date.now();
      const entries = logs.entries
        .filter((e) => fetchedAt - e.createdTimestamp < 15_000)
        .map((e) => ({
          executorId: e.executorId || e.executor?.id || "",
          type: e.action,
          createdTimestamp: e.createdTimestamp,
          targetId: e.targetId ?? undefined,
        }))
        .filter((e) => e.executorId.length > 0);

      auditLogCache.set(cacheKey, { entries, fetchedAt });
    } catch (error: any) {
      // On 429, extend the rate limit spacing to respect Discord's backoff
      if (error?.status === 429 || error?.httpStatus === 429) {
        const retryAfter = error?.retry_after ? Math.ceil(error.retry_after * 1000) : 10_000;
        auditLogLastFetchAt.set(cacheKey, Date.now() + retryAfter - AUDIT_LOG_MIN_SPACING_MS);
        logger.warn(`[ ANTINUKE ] Audit log 429 for guild ${guild.id}, backing off ${retryAfter}ms`);
      }
      // Cache empty result to prevent retry storm
      auditLogCache.set(cacheKey, { entries: [], fetchedAt: Date.now() });
    }
  })();

  pendingAuditFetches.set(cacheKey, fetchPromise);
  await fetchPromise;
  pendingAuditFetches.delete(cacheKey);

  return auditLogCache.get(cacheKey) || { entries: [], fetchedAt: Date.now() };
}

function getMostRecentExecutorIdByTypes(
  entries: AuditLogCacheEntry["entries"],
  typeSet: Set<number>,
  targetId?: string,
): string | null {
  let latestTargetMatchedTs = -1;
  let latestTargetMatchedExecutorId: string | null = null;

  let latestTs = -1;
  let latestExecutorId: string | null = null;

  for (const entry of entries) {
    if (!typeSet.has(entry.type)) continue;

    if (targetId && entry.targetId === targetId && entry.createdTimestamp > latestTargetMatchedTs) {
      latestTargetMatchedTs = entry.createdTimestamp;
      latestTargetMatchedExecutorId = entry.executorId;
    }

    if (entry.createdTimestamp > latestTs) {
      latestTs = entry.createdTimestamp;
      latestExecutorId = entry.executorId;
    }
  }

  if (targetId && latestTargetMatchedExecutorId) {
    return latestTargetMatchedExecutorId;
  }

  return latestExecutorId;
}

/**
 * Resolve executor from cached audit logs. Falls back to a single fresh fetch
 * if the cache doesn't contain a matching entry (with one 800ms retry).
 */
async function resolveExecutorIdFromAudit(
  guild: Guild,
  action: AntiNukeAction,
  options?: RunAntiNukeOptions,
): Promise<string | null> {
  if (options?.executorId) return options.executorId;

  const types = options?.auditTypes?.length
    ? options.auditTypes
    : [options?.auditType ?? getAuditType(action)];
  const typeSet = new Set(types.map((t) => Number(t)));
  const targetId = options?.targetId;

  // Attempt 1: check cached audit logs (0ms if cache is fresh)
  const cached = await ensureAuditLogsCached(guild);
  const cachedExecutorId = getMostRecentExecutorIdByTypes(cached.entries, typeSet, targetId);
  if (cachedExecutorId) return cachedExecutorId;

  // Don't wait 800ms for every normal member leave — 99% of leaves are not kicks/prunes
  if (action === "memberKick" || action === "memberPrune") {
    return null;
  }

  // Attempt 2: cache may be stale — invalidate and retry once after 800ms
  // (Discord audit logs can have ~2s propagation delay)
  await new Promise((r) => setTimeout(r, 800));
  auditLogCache.delete(guild.id);
  const fresh = await ensureAuditLogsCached(guild);

  return getMostRecentExecutorIdByTypes(fresh.entries, typeSet, targetId);
}

function isExtraOwner(config: Awaited<ReturnType<typeof getAntiNukeConfig>>, executorId: string): boolean {
  if (!config || !Array.isArray(config.extraOwnerIds)) return false;
  return config.extraOwnerIds.includes(executorId);
}

function hasWhitelistLimitBypassRole(
  member: GuildMember | null,
  config: Awaited<ReturnType<typeof getAntiNukeConfig>>,
): boolean {
  if (!member || !config) return false;
  if (!Array.isArray(config.whitelistLimitsBypassRoles) || config.whitelistLimitsBypassRoles.length === 0) return false;
  return config.whitelistLimitsBypassRoles.some((roleId) => member.roles.cache.has(roleId));
}

async function getExecutorMemberCached(guild: Guild, executorId: string): Promise<GuildMember | null> {
  const key = `${guild.id}:${executorId}`;
  const cached = executorMemberCache.get(key);
  if (cached) return cached;

  let member = guild.members.cache.get(executorId);
  if (!member) {
    member = await guild.members.fetch(executorId).catch(() => undefined);
  }
  
  if (member) executorMemberCache.set(key, member);
  return member || null;
}

function updateCachedAntiNukeConfig(guildId: string, config: Awaited<ReturnType<typeof getAntiNukeConfig>> | null): void {
  antiNukeConfigCache.set(guildId, { config });
}

async function getGuildProtectionState(
  guildId: string,
): Promise<{ premiumActive: boolean; config: Awaited<ReturnType<typeof getAntiNukeConfig>> | null }> {
  const cachedPremium = premiumStatusCache.get(guildId);
  const premiumActive = typeof cachedPremium === "boolean"
    ? cachedPremium
    : await isGuildPremiumActive(guildId);

  if (typeof cachedPremium !== "boolean") {
    premiumStatusCache.set(guildId, premiumActive);
  }

  if (!premiumActive) {
    return { premiumActive: false, config: null };
  }

  const cachedConfig = antiNukeConfigCache.get(guildId);
  if (cachedConfig) {
    return { premiumActive: true, config: cachedConfig.config };
  }

  const config = await getAntiNukeConfig(guildId);
  updateCachedAntiNukeConfig(guildId, config);
  return { premiumActive: true, config };
}

function resolveTierLimits(profile: AntiNukeWhitelistAccessProfile | null | undefined): { tier: AntiNukeTierName; threshold: number; window: number } | null {
  if (!profile || !profile.tier) return null;

  const tier = profile.tier;
  if (tier !== "staff" && tier !== "mod" && tier !== "admin") return null;

  const defaults = TIER_DEFAULT_LIMITS[tier];
  const threshold = typeof profile.tierLimitThreshold === "number" && Number.isFinite(profile.tierLimitThreshold)
    ? Math.max(1, Math.floor(profile.tierLimitThreshold))
    : defaults.threshold;
  const window = typeof profile.tierLimitWindow === "number" && Number.isFinite(profile.tierLimitWindow)
    ? Math.max(1, Math.floor(profile.tierLimitWindow))
    : defaults.window;

  return { tier, threshold, window };
}

type TimestampCounterStore = {
  get(key: string): number[] | undefined;
  set(key: string, value: number[]): unknown;
};

function countActionWithinWindow(counterMap: TimestampCounterStore, key: string, windowMs: number): number {
  const now = Date.now();
  const current = counterMap.get(key) || [];
  const cutoff = now - windowMs;

  let lo = 0;
  let hi = current.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (current[mid] < cutoff) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo > 0) {
    current.splice(0, lo);
  }

  current.push(now);
  counterMap.set(key, current);
  return current.length;
}

export async function evaluateAntiNukeAction(
  client: Bot,
  guild: Guild,
  action: AntiNukeAction,
  options?: RunAntiNukeOptions,
): Promise<AntiNukeActionEvaluation> {
  const state = await getGuildProtectionState(guild.id);
  const premiumActive = state.premiumActive;
  if (!premiumActive) {
    return { shouldEnforce: false, executorId: null, executorMember: null, config: null };
  }

  const config = state.config;
  if (!config || !config.enabled) {
    return { shouldEnforce: false, executorId: null, executorMember: null, config };
  }

  if (!ANTINUKE_PROTECTED_ACTIONS_SET.has(action)) {
    return { shouldEnforce: false, executorId: null, executorMember: null, config };
  }

  const moduleKey = ACTION_MODULE_KEY_MAP[action];
  const moduleStateValue = config.moduleStates?.[moduleKey];
  if (moduleStateValue === false) {
    return { shouldEnforce: false, executorId: null, executorMember: null, config };
  }

  const executorId = await resolveExecutorIdFromAudit(guild, action, options);
  if (!executorId) {
    return { shouldEnforce: false, executorId: null, executorMember: null, config };
  }

  // Fix 1.5 — skip if executor is the @everyone role (id === guild.id) — avoids false positives
  if (executorId === guild.id) {
    return { shouldEnforce: false, executorId, executorMember: null, config };
  }

  // Bypass for self-actions (e.g. users updating their own roles via Onboarding/Channels & Roles)
  if (options?.targetId && executorId === options.targetId) {
    return { shouldEnforce: false, executorId, executorMember: null, config };
  }

  if (executorId === guild.ownerId || executorId === client.user?.id) {
    return { shouldEnforce: false, executorId, executorMember: null, config };
  }

  if (isExtraOwner(config, executorId)) {
    return { shouldEnforce: false, executorId, executorMember: null, config };
  }

  const executorMember = await getExecutorMemberCached(guild, executorId);
  const hasBypassRole = hasWhitelistLimitBypassRole(executorMember, config);


  const profile = config.whitelistAccess?.[executorId];
  const hasActionWhitelist = Boolean(profile?.fullAccess)
    || Boolean(profile && Array.isArray(profile.actions) && profile.actions.includes(action))
    || config.whitelistUserIds.includes(executorId);

  // Check whitelist expiry (5.5)
  const expiryTs = config.whitelistExpiry?.[executorId];
  const isExpired = expiryTs ? Date.now() > new Date(expiryTs).getTime() : false;

  if (hasActionWhitelist && !isExpired) {
    if (!hasBypassRole && config.whitelistLimitsEnabled && config.whitelistLimitsActions?.includes(action)) {
      const globalThreshold = config.whitelistLimitsThreshold ?? 5;
      const globalWindow = config.whitelistLimitsWindow ?? 60;
      const count = countActionWithinWindow(
        actionCountersWhitelist,
        `${guild.id}:${executorId}:global`,
        globalWindow * 1000,
      );

      if (count > globalThreshold) {
        // Limit Exceeded: revoke whitelist immediately
        const newAccess = { ...config.whitelistAccess };
        delete newAccess[executorId];
        const newArray = config.whitelistUserIds.filter(id => id !== executorId);

        const updatedConfig = await updateAntiNukeConfig(guild.id, {
          whitelistAccess: newAccess,
          whitelistUserIds: newArray
        } as any);
        updateCachedAntiNukeConfig(guild.id, updatedConfig);

        logger.warn(`[ ANTINUKE ] Whitelisted user ${executorId} in ${guild.id} exceeded global whitelist limit. Whitelist revoked.`);
        return {
          shouldEnforce: true,
          executorId,
          executorMember,
          config,
          isWhitelistViolation: true,
          whitelistViolationReason: "Global whitelist rate limit exceeded",
          whitelistLimitThreshold: globalThreshold,
          whitelistLimitWindow: globalWindow,
        };
      }
    }

    if (!hasBypassRole) {
      const tierLimits = resolveTierLimits(profile);
      if (tierLimits) {
        const count = countActionWithinWindow(
          actionCountersTierWhitelist,
          `${guild.id}:${executorId}:user:${tierLimits.tier}`,
          tierLimits.window * 1000,
        );

        if (count > tierLimits.threshold) {
          const newAccess = { ...config.whitelistAccess };
          delete newAccess[executorId];
          const newArray = config.whitelistUserIds.filter((id) => id !== executorId);

          const updatedConfig = await updateAntiNukeConfig(guild.id, {
            whitelistAccess: newAccess,
            whitelistUserIds: newArray,
          } as any);
          updateCachedAntiNukeConfig(guild.id, updatedConfig);

          logger.warn(`[ ANTINUKE ] Tier-whitelisted user ${executorId} in ${guild.id} exceeded ${tierLimits.tier} tier limit. Whitelist revoked.`);
          return {
            shouldEnforce: true,
            executorId,
            executorMember,
            config,
            isWhitelistViolation: true,
            whitelistViolationReason: `${tierLimits.tier.toUpperCase()} tier limit exceeded`,
            whitelistLimitThreshold: tierLimits.threshold,
            whitelistLimitWindow: tierLimits.window,
          };
        }
      }
    }

    return { shouldEnforce: false, executorId, executorMember, config };
  }

  // ── Role-level whitelist check ──────────────────────────────────────────
  if (executorMember && config.whitelistRoleAccess && typeof config.whitelistRoleAccess === "object") {
    let matchedRoleProfile: AntiNukeWhitelistAccessProfile | null = null;
    let matchedRoleId: string | null = null;

    for (const [roleId, roleProfile] of Object.entries(config.whitelistRoleAccess)) {
      if (!executorMember.roles.cache.has(roleId)) continue;
      if (!roleProfile || typeof roleProfile !== "object") continue;

      const roleFullAccess = Boolean(roleProfile.fullAccess);
      const roleHasAction = roleFullAccess || (Array.isArray(roleProfile.actions) && roleProfile.actions.includes(action));

      if (roleHasAction) {
        matchedRoleProfile = roleProfile as AntiNukeWhitelistAccessProfile;
        matchedRoleId = roleId;
        break;
      }
    }

    if (matchedRoleProfile) {
      // Role-whitelisted users are also subject to whitelist limits
      if (!hasBypassRole && config.whitelistLimitsEnabled && config.whitelistLimitsActions?.includes(action)) {
        const globalThreshold = config.whitelistLimitsThreshold ?? 5;
        const globalWindow = config.whitelistLimitsWindow ?? 60;
        const count = countActionWithinWindow(
          actionCountersWhitelist,
          `${guild.id}:${executorId}:global`,
          globalWindow * 1000,
        );

        if (count > globalThreshold) {
          logger.warn(`[ ANTINUKE ] Role-whitelisted user ${executorId} in ${guild.id} exceeded global whitelist limit.`);
          return {
            shouldEnforce: true,
            executorId,
            executorMember,
            config,
            isWhitelistViolation: true,
            whitelistViolationReason: "Global whitelist rate limit exceeded",
            whitelistLimitThreshold: globalThreshold,
            whitelistLimitWindow: globalWindow,
          };
        }
      }

      if (!hasBypassRole) {
        const tierLimits = resolveTierLimits(matchedRoleProfile);
        if (tierLimits) {
          const count = countActionWithinWindow(
            actionCountersTierWhitelist,
            `${guild.id}:${executorId}:role:${tierLimits.tier}`,
            tierLimits.window * 1000,
          );

          if (count > tierLimits.threshold) {
            logger.warn(`[ ANTINUKE ] Role-whitelisted user ${executorId} in ${guild.id} exceeded ${tierLimits.tier} tier limit (role ${matchedRoleId ?? "unknown"}).`);
            return {
              shouldEnforce: true,
              executorId,
              executorMember,
              config,
              isWhitelistViolation: true,
              whitelistViolationReason: `${tierLimits.tier.toUpperCase()} tier limit exceeded`,
              whitelistLimitThreshold: tierLimits.threshold,
              whitelistLimitWindow: tierLimits.window,
            };
          }
        }
      }

      return { shouldEnforce: false, executorId, executorMember, config };
    }
  }

  return { shouldEnforce: true, executorId, executorMember, config };
}

// ─────────────────────────────────────────────────────────────────────────────
// Punishment helpers
// ─────────────────────────────────────────────────────────────────────────────

const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageWebhooks,
];

async function clearMemberRoles(member: GuildMember, reason: string): Promise<number> {
  const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!botMember || !member.manageable) return 0;

  const removableRoles = member.roles.cache
    .filter((role) => (
      role.id !== member.guild.id
      && !role.managed
      && role.position < botMember.roles.highest.position
    ));

  if (removableRoles.size === 0) return 0;
  await member.roles.remove(removableRoles, reason).catch(() => null);
  return removableRoles.size;
}

/**
 * Fix 3.2 — Role-strip punishment: removes all dangerous permissions from the executor's roles.
 */
async function roleStripMember(guild: Guild, executorId: string, reason: string): Promise<void> {
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member || !member.manageable) return;

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) return;

  for (const role of member.roles.cache.values()) {
    if (role.id === guild.id || role.managed || !role.editable) continue;
    if (role.position >= botMember.roles.highest.position) continue;

    const hasDangerous = DANGEROUS_PERMISSIONS.some((p) => role.permissions.has(p));
    if (!hasDangerous) continue;

    const newPerms = new PermissionsBitField(role.permissions.bitfield);
    for (const p of DANGEROUS_PERMISSIONS) newPerms.remove(p);
    await role.setPermissions(newPerms, reason).catch(() => null);
    // Rate limit protection: 1200ms between role permission edits to avoid 429s
    await new Promise(r => setTimeout(r, 1200));
  }
}

/**
 * Fix 3.1 — Staged punishment: escalates based on per-user offence history.
 * Returns the effective punishment and the new offence count.
 */
async function resolveEffectivePunishment(
  guildId: string,
  executorId: string,
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
  action: AntiNukeAction,
): Promise<{ punishment: AntiNukePunishment; newCount: number }> {
  // Per-module override (5.6): check modulePunishments first
  const moduleOverride = config.modulePunishments?.[action];

  const basePunishment = moduleOverride || config.punishment;

  // Staged escalation (3.1)
  if (basePunishment === "staged") {
    const now = Date.now();
    const history = config.offenceHistory ?? {};
    const record = history[executorId] || { count: 0, lastAt: new Date(0).toISOString() };
    const age = now - new Date(record.lastAt).getTime();
    const resetWindow = 24 * 60 * 60 * 1000; // 24h

    const count = age > resetWindow ? 1 : record.count + 1;
    const updatedHistory = {
      ...history,
      [executorId]: { count, lastAt: new Date().toISOString() },
    };

    await updateAntiNukeConfig(guildId, { offenceHistory: updatedHistory } as any).catch(() => null);

    let staged: AntiNukePunishment;
    if (count === 1) staged = "warn";
    else if (count === 2) staged = "timeout";
    else if (count === 3) staged = "kick";
    else staged = "ban";

    return { punishment: staged, newCount: count };
  }

  return { punishment: basePunishment as AntiNukePunishment, newCount: 0 };
}

function getSecondGenRuntimeConfig(config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>): {
  enabled: boolean;
  threshold: number;
  windowSeconds: number;
  punishment: AntiNukePunishment;
} {
  const rawStates = config.moduleStates && typeof config.moduleStates === "object"
    ? (config.moduleStates as Record<string, unknown>)
    : {};

  const enabled = rawStates.__beast_mode_enabled === true;
  const thresholdRaw = typeof rawStates.__beast_mode_threshold === "number" ? rawStates.__beast_mode_threshold : 1;
  const windowRaw = typeof rawStates.__beast_mode_window === "number" ? rawStates.__beast_mode_window : 8;
  const punishmentRaw = typeof rawStates.__beast_mode_punishment === "string" ? rawStates.__beast_mode_punishment : "ban";

  const threshold = Math.max(1, Math.min(5, Math.floor(thresholdRaw)));
  const windowSeconds = Math.max(3, Math.min(30, Math.floor(windowRaw)));
  const punishment: AntiNukePunishment = punishmentRaw === "warn"
    || punishmentRaw === "ban"
    || punishmentRaw === "kick"
    || punishmentRaw === "timeout"
    || punishmentRaw === "quarantine"
    || punishmentRaw === "rolestrip"
    || punishmentRaw === "staged"
    ? punishmentRaw
    : "ban";

  return { enabled, threshold, windowSeconds, punishment };
}

function getAegisCoreRuntimeConfig(config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>): {
  enabled: boolean;
  memberLossThreshold: number;
  channelDeleteThreshold: number;
  roleMutationThreshold: number;
  mentionBurstThreshold: number;
  windowSeconds: number;
} {
  const rawStates = config.moduleStates && typeof config.moduleStates === "object"
    ? (config.moduleStates as Record<string, unknown>)
    : {};

  const enabled = rawStates.__aegis_core_enabled === true;
  const memberLossRaw = typeof rawStates.__aegis_core_member_loss_threshold === "number"
    ? rawStates.__aegis_core_member_loss_threshold
    : 100;
  const channelDeleteRaw = typeof rawStates.__aegis_core_channel_delete_threshold === "number"
    ? rawStates.__aegis_core_channel_delete_threshold
    : 10;
  const roleMutationRaw = typeof rawStates.__aegis_core_role_mutation_threshold === "number"
    ? rawStates.__aegis_core_role_mutation_threshold
    : 10;
  const mentionBurstRaw = typeof rawStates.__aegis_core_mention_burst_threshold === "number"
    ? rawStates.__aegis_core_mention_burst_threshold
    : 5;
  const windowRaw = typeof rawStates.__aegis_core_window_seconds === "number"
    ? rawStates.__aegis_core_window_seconds
    : 60;

  return {
    enabled,
    memberLossThreshold: Math.max(10, Math.min(500, Math.floor(memberLossRaw))),
    channelDeleteThreshold: Math.max(1, Math.min(50, Math.floor(channelDeleteRaw))),
    roleMutationThreshold: Math.max(1, Math.min(50, Math.floor(roleMutationRaw))),
    mentionBurstThreshold: Math.max(1, Math.min(50, Math.floor(mentionBurstRaw))),
    windowSeconds: Math.max(10, Math.min(300, Math.floor(windowRaw))),
  };
}

/** Default 1d — user can rejoin without auto-ban after this window (per stored expiry). */
const DEFAULT_GEN2_REJOIN_COOLDOWN_MS = 86_400_000;
const GEN2_REJOIN_WATCH_KEY = "__gen2_rejoin_watch_json";
const GEN2_REJOIN_COOLDOWN_KEY = "__gen2_rejoin_cooldown_ms";
const GEN2_REJOIN_GATE_ENABLED_KEY = "__gen2_rejoin_enabled";

const GEN2_REJOIN_COOLDOWN_PRESETS_MS = [
  3_600_000, // 1h
  21_600_000, // 6h
  43_200_000, // 12h
  86_400_000, // 1d
  259_200_000, // 3d
  604_800_000, // 7d
] as const;

function isGen2RejoinGateFeatureEnabled(states: Record<string, unknown>): boolean {
  return states[GEN2_REJOIN_GATE_ENABLED_KEY] !== false;
}

/** Cycle UI preset for Gen2 rejoin-ban cooldown (used by manage panel). */
export function cycleGen2RejoinCooldownMs(currentMs: number): number {
  const presets = [...GEN2_REJOIN_COOLDOWN_PRESETS_MS];
  let idx = presets.indexOf(currentMs as (typeof GEN2_REJOIN_COOLDOWN_PRESETS_MS)[number]);
  if (idx < 0) {
    const nearest = presets.findIndex((p) => p >= currentMs);
    idx = nearest >= 0 ? nearest : 3;
  }
  return presets[(idx + 1) % presets.length];
}

export function formatGen2CooldownLabel(ms: number): string {
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function getGen2RejoinGateSettingsForUi(
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
): { gateEnabled: boolean; cooldownMs: number } {
  const states = moduleStatesRecord(config);
  return {
    gateEnabled: isGen2RejoinGateFeatureEnabled(states),
    cooldownMs: getGen2RejoinCooldownMsFromStates(states),
  };
}

function moduleStatesRecord(config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>): Record<string, unknown> {
  return config.moduleStates && typeof config.moduleStates === "object"
    ? { ...(config.moduleStates as Record<string, unknown>) }
    : {};
}

function parseGen2RejoinWatchMap(states: Record<string, unknown>): Record<string, number> {
  const raw = states[GEN2_REJOIN_WATCH_KEY];
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!k) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function pruneGen2RejoinWatchMap(map: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [uid, exp] of Object.entries(map)) {
    if (exp > now) out[uid] = exp;
  }
  return out;
}

function getGen2RejoinCooldownMsFromStates(states: Record<string, unknown>): number {
  const raw = states[GEN2_REJOIN_COOLDOWN_KEY];
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 300_000 && raw <= 30 * 86_400_000) {
    return Math.floor(raw);
  }
  return DEFAULT_GEN2_REJOIN_COOLDOWN_MS;
}

async function persistGen2RejoinWatch(
  guildId: string,
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
  nextMap: Record<string, number>,
): Promise<void> {
  const states = moduleStatesRecord(config);
  const pruned = pruneGen2RejoinWatchMap(nextMap);
  states[GEN2_REJOIN_WATCH_KEY] = JSON.stringify(pruned);
  await updateAntiNukeConfig(guildId, { moduleStates: states } as any).catch(() => null);
}

async function registerGen2RejoinBanWatch(
  guildId: string,
  userId: string,
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
): Promise<void> {
  const states = moduleStatesRecord(config);
  if (!isGen2RejoinGateFeatureEnabled(states)) return;
  const cooldown = getGen2RejoinCooldownMsFromStates(states);
  let map = pruneGen2RejoinWatchMap(parseGen2RejoinWatchMap(states));
  map[userId] = Date.now() + cooldown;
  await persistGen2RejoinWatch(guildId, config, map);
}

/**
 * If AntiNuke 2nd Gen is on and this user was Gen2-banned within the rejoin cooldown window, ban again and extend the window.
 * @returns true if the member was banned (caller should skip welcome flows).
 */
export async function handleGen2RejoinReBan(client: Bot, member: GuildMember): Promise<boolean> {
  const latest = await getAntiNukeConfig(member.guild.id);
  if (!latest) return false;
  if (!latest.enabled) return false;
  const secondGen = getSecondGenRuntimeConfig(latest);
  if (!secondGen.enabled) return false;

  const states = moduleStatesRecord(latest);
  if (!isGen2RejoinGateFeatureEnabled(states)) return false;

  const now = Date.now();
  let map = parseGen2RejoinWatchMap(states);
  const exp = map[member.id];

  if (!exp) {
    const pruned = pruneGen2RejoinWatchMap(map);
    if (Object.keys(pruned).length !== Object.keys(map).length) {
      await persistGen2RejoinWatch(member.guild.id, latest, pruned);
    }
    return false;
  }

  if (now >= exp) {
    delete map[member.id];
    map = pruneGen2RejoinWatchMap(map);
    await persistGen2RejoinWatch(member.guild.id, latest, map);
    return false;
  }

  const reason = "[ANTINUKE 2nd Gen] Rejoin during post-ban cooldown";
  await member.ban({ reason, deleteMessageSeconds: 3600 }).catch(() => null);

  const cooldown = getGen2RejoinCooldownMsFromStates(states);
  map[member.id] = Date.now() + cooldown;
  await persistGen2RejoinWatch(member.guild.id, latest, map);

  await addAntiNukeAudit(member.guild.id, client.user?.id ?? "0", "gen2 rejoin ban", {
    userId: member.id,
    cooldownMs: cooldown,
  });

  return true;
}

function formatPunishmentLabel(punishment: AntiNukePunishment): string {
  switch (punishment) {
    case "ban":
      return "Permanent Ban";
    case "kick":
      return "Kick";
    case "timeout":
      return "Temporary Timeout";
    case "rolestrip":
      return "Dangerous Permissions Removed";
    case "warn":
      return "Warning";
    case "quarantine":
      return "Quarantine";
    case "staged":
      return "Escalation";
    default:
      return "Security Action";
  }
}

function formatAntiNukeReason(reason: string): string {
  const normalized = reason.replace(/\[ANTINUKE\]\s*/gi, "").trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("whitelist rate limit exceeded")) {
    return "Whitelisted safety limit was exceeded by suspicious moderation actions.";
  }

  if (lower.includes("tier limit exceeded")) {
    return "Tier-based whitelist safety limit was exceeded by suspicious moderation actions.";
  }

  const thresholdMatch = normalized.match(/^([a-zA-Z]+)\s+threshold exceeded/i);
  if (thresholdMatch?.[1]) {
    const key = thresholdMatch[1] as AntiNukeAction;
    const label = ACTION_LABELS[key] ?? thresholdMatch[1];
    return `Unauthorized ${label.toLowerCase()} activity exceeded the server safety threshold.`;
  }

  if (lower.includes("panic")) {
    return "Panic mode is active and triggered immediate security enforcement.";
  }

  return normalized.length > 0
    ? normalized
    : "Unauthorized high-risk moderation activity was detected.";
}

async function notifyPunishedUser(
  executorId: string,
  member: GuildMember | null,
  guild: Guild,
  punishment: AntiNukePunishment,
  reason: string,
  timeoutDurationMs: number,
): Promise<void> {
  if (punishment === "warn") return;

  const punishmentLabel = formatPunishmentLabel(punishment);
  const readableReason = formatAntiNukeReason(reason);
  const timeoutText = punishment === "timeout"
    ? `${Math.max(1, Math.floor(timeoutDurationMs / 60_000))} minute(s)`
    : null;

  const user = member?.user || (await guild.client.users.fetch(executorId).catch(() => null));
  if (!user) return;

  await user.send({
    embeds: [
      {
        color: EmbedColors.ERROR,
        title: "Security Enforcement Notice",
        description: `Your account triggered **AntiNuke** protection in **${guild.name}**.`,
        fields: [
          {
            name: "Action Taken",
            value: punishmentLabel,
            inline: true,
          },
          {
            name: "Reason",
            value: readableReason,
            inline: false,
          },
          ...(timeoutText
            ? [{
              name: "Duration",
              value: timeoutText,
              inline: true,
            }]
            : []),
          {
            name: "Appeal",
            value: "If you believe this action is incorrect, contact the server owner or moderation team.",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      } as any,
    ],
  }).catch(() => null);
}

async function punishMember(
  guild: Guild,
  executorId: string,
  punishment: AntiNukePunishment,
  reason: string,
  timeoutDurationMs: number,
  resolvedMember?: GuildMember | null,
): Promise<number> {
  if (punishment === "warn") return 0;

  const member = resolvedMember ?? await guild.members.fetch(executorId).catch(() => null);
  await notifyPunishedUser(executorId, member, guild, punishment, reason, timeoutDurationMs);

  if (punishment === "rolestrip") {
    await roleStripMember(guild, executorId, reason);
    return 0;
  }

  if (punishment === "quarantine") {
    if (member) {
      await quarantineMember(guild, member, "antinuke", reason).catch(() => null);
    }
    return 0;
  }

  let clearedRoleCount = 0;

  if (member) {
    clearedRoleCount = await clearMemberRoles(member, `${reason} | clearing roles before punishment`);
  }

  if (punishment === "ban") {
    await guild.members.ban(executorId, { reason }).catch(() => null);
    return clearedRoleCount;
  }

  if (!member) return clearedRoleCount;

  if (punishment === "kick") {
    await member.kick(reason).catch(() => null);
    return clearedRoleCount;
  }

  // timeout — use configurable duration (1.3)
  await member.timeout(timeoutDurationMs, reason).catch(() => null);
  return clearedRoleCount;
}

function pushAegisTimestamp(timestamps: number[], now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  let lo = 0;
  let hi = timestamps.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) timestamps.splice(0, lo);
  timestamps.push(now);
}

async function stripDangerousPermissionsFromAllRoles(guild: Guild, reason: string): Promise<number> {
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) return 0;

  let changed = 0;
  const roles = [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position);

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    if (role.managed || !role.editable) continue;
    if (role.position >= botMember.roles.highest.position) continue;

    const hasDangerous = DANGEROUS_PERMISSIONS.some((p) => role.permissions.has(p));
    if (!hasDangerous) continue;

    const newPerms = new PermissionsBitField(role.permissions.bitfield);
    for (const p of DANGEROUS_PERMISSIONS) newPerms.remove(p);
    await role.setPermissions(newPerms, reason).catch(() => null);
    changed++;
    await new Promise((r) => setTimeout(r, 1200));
  }

  return changed;
}

async function evaluateAegisCore(
  guild: Guild,
  executorId: string,
  action: AntiNukeAction,
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
  contextLabel: string,
  executorMember: GuildMember | null,
): Promise<boolean> {
  const settings = getAegisCoreRuntimeConfig(config);
  if (!settings.enabled) return false;

  const WINDOW_MS = settings.windowSeconds * 1000;
  const MEMBER_LOSS_THRESHOLD = settings.memberLossThreshold;
  const CHANNEL_MUTATION_THRESHOLD = settings.channelDeleteThreshold;
  const ROLE_MUTATION_THRESHOLD = settings.roleMutationThreshold;
  const MENTION_BURST_THRESHOLD = settings.mentionBurstThreshold;
  const COOLDOWN_MS = 120_000;
  const key = `${guild.id}:${executorId}`;
  const now = Date.now();

  const state = aegisCounters.get(key) || { memberLossTimestamps: [], channelDeleteTimestamps: [], roleMutationTimestamps: [], mentionBurstTimestamps: [] };
  if (action === "memberKick" || action === "memberPrune" || action === "banAdd") {
    pushAegisTimestamp(state.memberLossTimestamps, now, WINDOW_MS);
  } else if (action === "channelDelete" || action === "channelCreate") {
    pushAegisTimestamp(state.channelDeleteTimestamps, now, WINDOW_MS);
  } else if (action === "roleCreate" || action === "roleDelete" || action === "memberRoleUpdate" || action === "roleUpdate") {
    pushAegisTimestamp(state.roleMutationTimestamps, now, WINDOW_MS);
  } else if (action === "everyoneHerePing" || action === "rolePing") {
    pushAegisTimestamp(state.mentionBurstTimestamps, now, WINDOW_MS);
  } else {
    return false;
  }
  aegisCounters.set(key, state);

  const infraNukeHit = state.channelDeleteTimestamps.length >= CHANNEL_MUTATION_THRESHOLD
    || state.roleMutationTimestamps.length >= ROLE_MUTATION_THRESHOLD
    || state.mentionBurstTimestamps.length >= MENTION_BURST_THRESHOLD;
  if (state.memberLossTimestamps.length < MEMBER_LOSS_THRESHOLD || !infraNukeHit) {
    return false;
  }

  const cooldownEnd = aegisCooldown.get(key) || 0;
  if (now < cooldownEnd) return false;
  aegisCooldown.set(key, now + COOLDOWN_MS);

  const reason = `[ANTINUKE:Aegis Core] Mass nuke pattern detected (${state.memberLossTimestamps.length} member losses + ${state.channelDeleteTimestamps.length} channel create/deletes + ${state.roleMutationTimestamps.length} role add/remove/create/delete + ${state.mentionBurstTimestamps.length} everyone/here-role pings in ${settings.windowSeconds}s)`;
  await punishMember(guild, executorId, "ban", reason, config.timeoutDuration ?? 3_600_000, executorMember);
  const rolesStripped = await stripDangerousPermissionsFromAllRoles(guild, reason);

  await addAntiNukeIncident({
    guildId: guild.id,
    executorId,
    action,
    punishment: "ban",
    contextLabel: `[AEGIS CORE] ${contextLabel}`,
    threshold: Math.max(MEMBER_LOSS_THRESHOLD, CHANNEL_MUTATION_THRESHOLD, ROLE_MUTATION_THRESHOLD),
    details: `Aegis Core trigger: members=${state.memberLossTimestamps.length}, channels=${state.channelDeleteTimestamps.length}, roles=${state.roleMutationTimestamps.length}, mentions=${state.mentionBurstTimestamps.length}, globalRolesStripped=${rolesStripped}`,
  });

  await sendIncidentLog(
    guild,
    config.logChannelId,
    "Aegis Core Triggered",
    `<@${executorId}> matched emergency nuke pattern.\n**Member Loss (${settings.windowSeconds}s):** ${state.memberLossTimestamps.length}\n**Channel Create/Delete (${settings.windowSeconds}s):** ${state.channelDeleteTimestamps.length}\n**Role Add/Remove/Create/Delete (${settings.windowSeconds}s):** ${state.roleMutationTimestamps.length}\n**Everyone/Here + Role Pings (${settings.windowSeconds}s):** ${state.mentionBurstTimestamps.length}\n**Roles Hardened:** ${rolesStripped}`,
    { executorId, action, punishment: "ban + global-role-strip", threshold: MEMBER_LOSS_THRESHOLD, isHighRisk: true },
  );

  await sendPunishmentWebhook(config, guild, executorId, action, "ban + global-role-strip (Aegis Core)", contextLabel);
  return true;
}

/** Join / profile gates (Gen3) — same enforcement path as incident punishments. */
export async function applyAntiNukeMemberPunishment(
  guild: Guild,
  userId: string,
  punishment: AntiNukePunishment,
  reason: string,
  timeoutDurationMs: number,
  resolvedMember?: GuildMember | null,
): Promise<number> {
  return punishMember(guild, userId, punishment, reason, timeoutDurationMs, resolvedMember);
}

// ─────────────────────────────────────────────────────────────────────────────
// Incident log helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fix 4.1 — Rich incident embed sent to the configured log channel.
 */
export async function sendIncidentLog(
  guild: Guild,
  channelId: string | null,
  title: string,
  description: string,
  options?: {
    action?: AntiNukeAction;
    executorId?: string;
    targetId?: string;
    punishment?: string;
    threshold?: number;
    recovered?: boolean;
    isNearMiss?: boolean;
    isHighRisk?: boolean;
  },
): Promise<void> {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !("send" in channel)) return;

  const isNearMiss = options?.isNearMiss ?? false;
  const isHighRisk = options?.isHighRisk ?? false;
  const action = options?.action;
  const actionLabel = action ? (ACTION_LABELS[action] ?? action) : "";
  const actionEmoji = action ? (ACTION_EMOJIS[action] ?? "🛡️") : "🛡️";

  const color = isHighRisk ? EmbedColors.ERROR : isNearMiss ? EmbedColors.WARNING ?? EmbedColors.ERROR : EmbedColors.ERROR;
  const headerTitle = isHighRisk
    ? `🚨 HIGH-RISK PATTERN DETECTED: ${guild.name}`
    : isNearMiss
      ? `⚠️ Near-Miss Warning`
      : `${actionEmoji} AntiNuke: ${actionLabel || title}`;

  const lines: string[] = [];
  if (options?.executorId) lines.push(`**Executor:** <@${options.executorId}>`);
  if (action) lines.push(`**Action:** ${actionEmoji} ${actionLabel}`);
  if (options?.targetId) lines.push(`**Target:** <@${options.targetId}>`);
  if (options?.punishment) lines.push(`**Punishment Applied:** ${options.punishment}`);
  if (options?.threshold !== undefined) lines.push(`**Threshold Hit:** \`${options.threshold}\``);
  if (options?.recovered !== undefined) lines.push(`**Auto-Recovered:** ${options.recovered ? "✅ Yes" : "❌ No"}`);
  if (description && !lines.some((l) => l.includes(description))) lines.push(description);

  const sections = [{ title: isNearMiss ? "⚠️ Warning" : "📋 Incident Details", content: lines.join("\n") }];
  const panel = V2.sections(color, headerTitle, sections, `<t:${Math.floor(Date.now() / 1000)}:F>`);

  await (channel as any).send({ components: [panel as any], ...V2_FLAGS }).catch(() => null);
}

/**
 * Fix 3.3 — Send punish event to an external webhook URL.
 */
async function sendPunishmentWebhook(
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
  guild: Guild,
  executorId: string,
  action: AntiNukeAction,
  punishment: string,
  contextLabel: string,
): Promise<void> {
  if (!config.webhookUrl) return;
  try {
    const wh = new WebhookClient({ url: config.webhookUrl });
    await wh.send({
      content: [
        "🚨 **AntiNuke Punishment Event**",
        `**Server:** ${guild.name} (\`${guild.id}\`)`,
        `**Executor:** <@${executorId}> (\`${executorId}\`)`,
        `**Action:** ${ACTION_LABELS[action] ?? action}`,
        `**Punishment:** ${punishment}`,
        `**Context:** ${contextLabel}`,
        `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
      ].join("\n"),
    });
    wh.destroy();
  } catch {
    // ignore webhook delivery errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker (5.8)
// ─────────────────────────────────────────────────────────────────────────────

const circuitBreakerTripped = new Set<string>(); // guildIds currently in circuit-break

async function checkCircuitBreaker(guild: Guild, config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>): Promise<void> {
  if (circuitBreakerTripped.has(guild.id)) return;

  const CIRCUIT_WINDOW_MS = 5 * 60_000; // 5 minutes
  const CIRCUIT_LIMIT = 20; // 20 triggers in 5 minutes

  const now = Date.now();
  const recentCount = await countAntiNukeIncidentsSince(guild.id, now - CIRCUIT_WINDOW_MS);

  if (recentCount < CIRCUIT_LIMIT) return;

  circuitBreakerTripped.add(guild.id);

  logger.warn(`[ ANTINUKE ] ⚡ Circuit breaker tripped for guild ${guild.id} (${recentCount} incidents in 5min). Disabling AntiNuke temporarily.`);

  await updateAntiNukeConfig(guild.id, { enabled: false } as any).catch(() => null);

  try {
    const owner = await guild.fetchOwner();
    await owner.send({
      content: [
        "🚨 **AntiNuke Circuit Breaker Triggered**",
        "",
        `> Server: **${guild.name}**`,
        `> **${recentCount}** AntiNuke incidents fired within the last 5 minutes.`,
        "",
        "AntiNuke has been **automatically disabled** to prevent misconfiguration runaway.",
        "Please review your thresholds and re-enable with `antinuke enable`.",
      ].join("\n"),
    }).catch(() => null);
  } catch { /* ignore */ }

  // Auto-reset circuit breaker after 10 minutes
  setTimeout(() => circuitBreakerTripped.delete(guild.id), 10 * 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suspicious pattern detection (4.4)
// ─────────────────────────────────────────────────────────────────────────────

async function checkSuspiciousPattern(
  guild: Guild,
  executorId: string,
  action: AntiNukeAction,
  config: NonNullable<Awaited<ReturnType<typeof getAntiNukeConfig>>>,
): Promise<void> {
  const KEY = `${guild.id}:${executorId}`;
  const now = Date.now();
  const WINDOW = 30_000; // 30 seconds
  const PATTERN_THRESHOLD = 3; // 3 distinct actions = high-risk

  const existing = recentMultiModuleTriggers.get(KEY);
  if (!existing || now - existing.firstAt > WINDOW) {
    recentMultiModuleTriggers.set(KEY, { actions: new Set([action]), firstAt: now });
    return;
  }

  existing.actions.add(action);

  if (existing.actions.size >= PATTERN_THRESHOLD) {
    const actionList = [...existing.actions].map((a) => ACTION_LABELS[a] ?? a).join(", ");
    logger.warn(`[ ANTINUKE ] 🚨 Suspicious multi-module pattern detected for ${executorId} in ${guild.id}: ${actionList}`);

    await sendIncidentLog(
      guild,
      config.logChannelId,
      "Suspicious Pattern",
      `<@${executorId}> triggered **${existing.actions.size}** distinct AntiNuke modules within 30 seconds: ${actionList}`,
      { executorId, action, isHighRisk: true },
    );

    // Reset so we don't spam-alert
    recentMultiModuleTriggers.delete(KEY);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main protection entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runAntiNukeProtectionDetailed(
  client: Bot,
  guild: Guild,
  action: AntiNukeAction,
  contextLabel: string,
  options?: RunAntiNukeOptions,
): Promise<AntiNukeProtectionResult> {
  try {
    const evaluation = await evaluateAntiNukeAction(client, guild, action, options);
    if (!evaluation.shouldEnforce || !evaluation.executorId || !evaluation.config) {
      return { enforced: false, enforcedNow: false, cooldownOnly: false };
    }

    const { executorId, executorMember, config } = evaluation;

    // Pause the role queue early so our emergency operations don't collide
    // with queued traffic while we evaluate thresholds and apply punishment.
    pauseGuildQueue(guild.id, 10_000);

    const aegisTriggered = await evaluateAegisCore(guild, executorId, action, config, contextLabel, executorMember);
    if (aegisTriggered) {
      logger.warn(`[ ANTINUKE ] Aegis Core enforced on ${executorId} in ${guild.id}`);
      return { enforced: true, enforcedNow: true, cooldownOnly: false };
    }

    // ── Panic Mode branch — zero tolerance, bypass thresholds ──────────────
    const panicConfig = getPanicConfigFromAntiNuke(config);
    if (panicConfig.enabled) {
      const panicResult = await enforcePanicMode(guild, executorId, panicConfig, action, contextLabel);

      if (panicResult.enforced) {
        const panicPunishment = panicResult.executorBanned ? "ban" : "quarantine";

        await addAntiNukeIncident({
          guildId: guild.id,
          executorId,
          action,
          punishment: panicPunishment as AntiNukePunishment,
          contextLabel: `[PANIC] ${contextLabel}`,
          threshold: 0, // panic = zero tolerance
        });

        await sendIncidentLog(
          guild,
          config.logChannelId,
          "🚨 Panic Mode Enforcement",
          `**Panic Punishment:** ${panicPunishment}\n**Roles Stripped:** ${panicResult.rolesStripped}`,
          { action, executorId, punishment: `PANIC:${panicPunishment}`, threshold: 0 },
        );

        if (config.notifyOwner) {
          try {
            const owner = await guild.fetchOwner();
            await owner.send({
              content: [
                "🚨 **PANIC MODE — Immediate Enforcement**",
                "",
                `**Server:** ${guild.name}`,
                `**Executor:** <@${executorId}>`,
                `**Action:** ${ACTION_LABELS[action] ?? action}`,
                `**Context:** ${contextLabel}`,
                `**Punishment:** ${panicPunishment} (zero tolerance)`,
                `**Roles Stripped:** ${panicResult.rolesStripped}`,
              ].join("\n"),
            }).catch(() => null);
          } catch { /* ignore */ }
        }

        await sendPunishmentWebhook(config, guild, executorId, action, `PANIC:${panicPunishment}`, contextLabel);
        await checkSuspiciousPattern(guild, executorId, action, config);
        return { enforced: true, enforcedNow: true, cooldownOnly: false };
      }
    }

    // ── Normal mode — threshold-based enforcement ──────────────────────────

    if (evaluation.isWhitelistViolation) {
      const violationThreshold = evaluation.whitelistLimitThreshold ?? config.whitelistLimitsThreshold ?? 5;
      const violationWindow = evaluation.whitelistLimitWindow ?? config.whitelistLimitsWindow ?? 60;
      const violationReason = evaluation.whitelistViolationReason ?? "Whitelist rate limit exceeded";
      const punishment = config.whitelistLimitsPunishment ?? "ban";
      const reason = `[ANTINUKE] ${violationReason} (${violationThreshold} actions in ${violationWindow}s)`;

      // Emergency queue pause already applied at the top of enforcement block

      const clearedRoleCount = await punishMember(guild, executorId, punishment, reason, config.timeoutDuration ?? 3_600_000, executorMember);

      await addAntiNukeIncident({
        guildId: guild.id,
        executorId,
        action,
        punishment,
        contextLabel: `[WHITELIST LIMIT] ${violationReason} | ${contextLabel}`,
        threshold: violationThreshold,
      });

      await sendIncidentLog(
        guild,
        config.logChannelId,
        "🚨 Whitelist Limit Violation",
        `<@${executorId}> exceeded: **${violationReason}**.\n**Cleared Roles:** ${clearedRoleCount}`,
        { action, executorId, punishment, threshold: violationThreshold },
      );

      if (config.notifyOwner) {
        try {
          const owner = await guild.fetchOwner();
          await owner.send({
            content: [
              "🚨 **AntiNuke Whitelist Violation Alert**",
              "",
              `**Server:** ${guild.name}`,
              `**Executor:** <@${executorId}>`,
              `**Action:** ${ACTION_LABELS[action] ?? action}`,
              `**Context:** ${violationReason}`,
              `**Punishment:** ${punishment}`,
            ].join("\n"),
          }).catch(() => null);
        } catch { /* ignore */ }
      }

      await sendPunishmentWebhook(config, guild, executorId, action, punishment, contextLabel);
      return { enforced: true, enforcedNow: true, cooldownOnly: false };
    }

    const secondGen = getSecondGenRuntimeConfig(config);

    // Fix 5.3 — configurable threshold window (seconds → ms)
    // AntiNuke 2nd Gen can harden both window and threshold.
    const activeWindowSeconds = secondGen.enabled
      ? secondGen.windowSeconds
      : (config.thresholdWindow ?? 10);
    const windowMs = activeWindowSeconds * 1000;

    const key = `${guild.id}:${executorId}:${action}`;
    const now = Date.now();
    const counter = actionCounters.get(key) || { timestamps: [] };

    // Binary search for window cutoff — O(log n) vs O(n) filter
    const cutoff = now - windowMs;
    let lo = 0, hi = counter.timestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (counter.timestamps[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) counter.timestamps.splice(0, lo);

    counter.timestamps.push(now);
    actionCounters.set(key, counter);

    const configuredThreshold = config.thresholds?.[action] ?? 1;
    const threshold = secondGen.enabled
      ? Math.min(configuredThreshold, secondGen.threshold)
      : configuredThreshold;

    // Fix 4.3 — near-miss alert (threshold - 1 actions)
    if (counter.timestamps.length === threshold - 1 && threshold > 1) {
      await sendIncidentLog(
        guild,
        config.logChannelId,
        "Near-Miss Warning",
        `<@${executorId}> is \`${counter.timestamps.length}/${threshold}\` towards the **${ACTION_LABELS[action] ?? action}** threshold.`,
        { executorId, action, threshold, isNearMiss: true },
      );
    }

    if (counter.timestamps.length < threshold) {
      return { enforced: false, enforcedNow: false, cooldownOnly: false };
    }

    const cooldownKey = `${guild.id}:${executorId}`;
    const cooldownEnd = punishmentCooldown.get(cooldownKey) || 0;
    if (now < cooldownEnd) {
      return { enforced: true, enforcedNow: false, cooldownOnly: true };
    }

    punishmentCooldown.set(cooldownKey, now + (secondGen.enabled ? 15_000 : 60_000));

    // Fix 3.1 + 5.6 — staged + per-module punishment
    const { punishment: resolvedPunishment, newCount } = await resolveEffectivePunishment(guild.id, executorId, config, action);
    const punishment = secondGen.enabled ? secondGen.punishment : resolvedPunishment;
    const reason = `[ANTINUKE] ${action} threshold exceeded (${contextLabel})`;

    // Emergency queue pause already applied at the top of enforcement block

    // Fix 1.3 — configurable timeout duration
    const clearedRoleCount = await punishMember(guild, executorId, punishment, reason, config.timeoutDuration ?? 3_600_000, executorMember);

    await addAntiNukeIncident({
      guildId: guild.id,
      executorId,
      action,
      punishment,
      contextLabel,
      threshold,
    });

    if (secondGen.enabled && punishment === "ban") {
      const latestCfg = await getAntiNukeConfig(guild.id);
      if (latestCfg) await registerGen2RejoinBanWatch(guild.id, executorId, latestCfg).catch(() => null);
    }

    // Fix 4.1 — rich incident log embed
    await sendIncidentLog(
      guild,
      config.logChannelId,
      "AntiNuke Action Triggered",
      `**Cleared Roles:** ${clearedRoleCount}`,
      { action, executorId, punishment, threshold },
    );

    logger.warn(`[ ANTINUKE ] Punished ${executorId} in ${guild.id} for ${action} (${punishment})`);

    // DM owner on incident
    if (config.notifyOwner) {
      try {
        const owner = await guild.fetchOwner();
        const stagedNote = punishment === "staged" || config.punishment === "staged" ? ` (offence #${newCount})` : "";
        await owner.send({
          content: [
            "🚨 **AntiNuke Incident Alert**",
            "",
            `**Server:** ${guild.name}`,
            `**Executor:** <@${executorId}>`,
            `**Action:** ${ACTION_LABELS[action] ?? action}`,
            `**Context:** ${contextLabel}`,
            `**Punishment:** ${punishment}${stagedNote}`,
          ].join("\n"),
        }).catch(() => null);
      } catch { /* ignore DM failures */ }
    }

    // Fix 3.3 — send to external webhook if configured
    await sendPunishmentWebhook(config, guild, executorId, action, punishment, contextLabel);

    // Fix 4.4 — suspicious pattern detection
    await checkSuspiciousPattern(guild, executorId, action, config);

    // Fix 5.8 — circuit breaker
    await checkCircuitBreaker(guild, config);

    return { enforced: true, enforcedNow: true, cooldownOnly: false };
  } catch (error) {
    logger.debug(`[ ANTINUKE ] Runtime handler error (${action}) in ${guild.id}: ${error}`);
    return { enforced: false, enforcedNow: false, cooldownOnly: false };
  }
}

export async function runAntiNukeProtection(
  client: Bot,
  guild: Guild,
  action: AntiNukeAction,
  contextLabel: string,
  options?: RunAntiNukeOptions,
): Promise<boolean> {
  const result = await runAntiNukeProtectionDetailed(client, guild, action, contextLabel, options);
  return result.enforced;
}
