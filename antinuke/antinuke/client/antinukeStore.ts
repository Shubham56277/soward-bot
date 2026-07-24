
import logger from "../../utils/logger";

export type AntiNukePunishment = "warn" | "ban" | "kick" | "timeout" | "rolestrip" | "staged" | "quarantine";
export type AntiNukeTierName = "staff" | "mod" | "admin";
export type AntiNukeAction =
  | "banAdd"
  | "banRemove"
  | "memberKick"
  | "memberPrune"
  | "channelCreate"
  | "channelDelete"
  | "channelUpdate"
  | "emojiStickerCreate"
  | "emojiStickerDelete"
  | "emojiStickerUpdate"
  | "soundboardCreate"
  | "soundboardDelete"
  | "soundboardUpdate"
  | "everyoneHerePing"
  | "linkRole"
  | "roleCreate"
  | "roleUpdate"
  | "roleDelete"
  | "rolePing"
  | "memberRoleUpdate"
  | "integrationUpdate"
  | "autoModerationRuleCreate"
  | "autoModerationRuleUpdate"
  | "autoModerationRuleDelete"
  | "guildScheduledEventCreate"
  | "guildScheduledEventUpdate"
  | "guildScheduledEventDelete"
  | "webhookUpdate"
  | "autoRecovery"
  | "botAdd"
  | "guildUpdate"
  | "vanityUpdate";

export interface AntiNukeWhitelistAccessProfile {
  fullAccess: boolean;
  actions: AntiNukeAction[];
  tier?: AntiNukeTierName;
  tierLimitThreshold?: number;
  tierLimitWindow?: number;
  commandAccess?: string[];
}

export interface AntiNukeOffenceRecord {
  count: number;
  lastAt: string; // ISO timestamp
}

export interface AntiNukeConfig {
  guildId: string;
  enabled: boolean;
  enabledActions: AntiNukeAction[];
  moduleStates: Record<string, unknown>;
  extraOwnerIds: string[];
  requiredRoleIds: string[];
  punishment: AntiNukePunishment;
  logChannelId: string | null;
  whitelistUserIds: string[];
  whitelistAccess: Record<string, AntiNukeWhitelistAccessProfile>;
  whitelistRoleIds: string[];
  whitelistRoleAccess: Record<string, AntiNukeWhitelistAccessProfile>;
  thresholds: Record<AntiNukeAction, number>;
  // v2 fields
  notifyOwner: boolean;
  lockdownSnapshot: Record<string, string>; // roleId -> permsBigInt as string
  lockdownActive: boolean;
  timeoutDuration: number;   // ms
  thresholdWindow: number;   // seconds
  whitelistExpiry: Record<string, string>; // userId -> ISO timestamp
  modulePunishments: Record<string, AntiNukePunishment>; // action -> punishment
  offenceHistory: Record<string, AntiNukeOffenceRecord>; // userId -> offence record
  webhookUrl: string | null;
  whitelistLimitsEnabled: boolean;
  whitelistLimitsThreshold: number;
  whitelistLimitsWindow: number;
  whitelistLimitsPunishment: AntiNukePunishment;
  whitelistLimitsActions: AntiNukeAction[];
  whitelistLimitsBypassRoles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AntiNukeIncident {
  id: string;
  guildId: string;
  executorId: string;
  action: AntiNukeAction;
  punishment: AntiNukePunishment;
  contextLabel: string;
  threshold: number;
  targetId?: string | null;
  recovered?: boolean;
  details?: string | null;
  createdAt: string;
}

export interface AntiNukeAudit {
  id: string;
  guildId: string;
  actorId: string;
  command: string;
  details: Record<string, unknown>;
  createdAt: string;
}



export const ANTINUKE_WHITELIST_LIMIT = 50;
export const ANTINUKE_EXTRA_OWNER_LIMIT = 10;
export const ANTINUKE_REQUIRED_ROLE_LIMIT = 10;

export const ANTINUKE_PROTECTED_ACTIONS: AntiNukeAction[] = [
  "banAdd",
  "banRemove",
  "memberKick",
  "memberPrune",
  "channelCreate",
  "channelDelete",
  "channelUpdate",
  "emojiStickerCreate",
  "emojiStickerDelete",
  "emojiStickerUpdate",
  "soundboardCreate",
  "soundboardDelete",
  "soundboardUpdate",
  "everyoneHerePing",
  "linkRole",
  "roleCreate",
  "roleUpdate",
  "roleDelete",
  "rolePing",
  "memberRoleUpdate",
  "integrationUpdate",
  "autoModerationRuleCreate",
  "autoModerationRuleUpdate",
  "autoModerationRuleDelete",
  "guildScheduledEventCreate",
  "guildScheduledEventUpdate",
  "guildScheduledEventDelete",
  "webhookUpdate",
  "autoRecovery",
  "botAdd",
  "guildUpdate",
  "vanityUpdate",
];

export const ANTINUKE_DEFAULT_THRESHOLDS: Record<AntiNukeAction, number> = {
  banAdd: 1,
  banRemove: 1,
  memberKick: 1,
  memberPrune: 1,
  channelCreate: 1,
  channelDelete: 1,
  channelUpdate: 1,
  emojiStickerCreate: 1,
  emojiStickerDelete: 1,
  emojiStickerUpdate: 1,
  soundboardCreate: 1,
  soundboardDelete: 1,
  soundboardUpdate: 1,
  everyoneHerePing: 5,
  linkRole: 1,
  roleCreate: 1,
  roleUpdate: 1,
  roleDelete: 1,
  rolePing: 5,
  memberRoleUpdate: 1,
  integrationUpdate: 1,
  autoModerationRuleCreate: 1,
  autoModerationRuleUpdate: 1,
  autoModerationRuleDelete: 1,
  guildScheduledEventCreate: 1,
  guildScheduledEventUpdate: 1,
  guildScheduledEventDelete: 1,
  webhookUpdate: 1,
  autoRecovery: 1,
  botAdd: 1,
  guildUpdate: 1,
  vanityUpdate: 1,
};

export const ANTINUKE_INCIDENTS_LIMIT = 200;
const ANTINUKE_INCIDENT_PRUNE_CHECK_EVERY = 20;
const ANTINUKE_INCIDENT_PRUNE_OVERFLOW_BUFFER = 25;
const ANTINUKE_CONFIG_MISS_CACHE_TTL_SECONDS = 60;
const ANTINUKE_CONFIG_NULL_SENTINEL = "__NULL__";
const STORE_KEY = "antinuke";
const incidentPruneCounters = new Map<string, number>();



function normalizePunishment(value: string | undefined | null): AntiNukePunishment {
  if (value === "warn" || value === "ban" || value === "kick" || value === "timeout" || value === "rolestrip" || value === "staged" || value === "quarantine") return value;
  return "ban";
}

function normalizeTier(value: unknown): AntiNukeTierName | undefined {
  if (value === "staff" || value === "mod" || value === "admin") return value;
  return undefined;
}

function sanitizeTierLimitThreshold(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
  return Math.min(100, Math.floor(value));
}

function sanitizeTierLimitWindow(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
  return Math.min(3600, Math.floor(value));
}

function sanitizeThresholds(value: unknown): Record<AntiNukeAction, number> {
  const defaults = ANTINUKE_DEFAULT_THRESHOLDS;
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const result = {} as Record<AntiNukeAction, number>;
  for (const action of ANTINUKE_PROTECTED_ACTIONS) {
    result[action] = typeof input[action] === "number"
      ? Math.max(1, Math.floor(input[action] as number))
      : defaults[action];
  }
  return result;
}

function sanitizeConfig(input: Partial<AntiNukeConfig>): AntiNukeConfig {
  const whitelist = Array.isArray(input.whitelistUserIds)
    ? [...new Set(input.whitelistUserIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
      .slice(0, ANTINUKE_WHITELIST_LIMIT)
    : [];

  const extraOwnerIds = Array.isArray(input.extraOwnerIds)
    ? [...new Set(input.extraOwnerIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
      .slice(0, ANTINUKE_EXTRA_OWNER_LIMIT)
    : [];

  const requiredRoleIds = Array.isArray(input.requiredRoleIds)
    ? [...new Set(input.requiredRoleIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
      .slice(0, ANTINUKE_REQUIRED_ROLE_LIMIT)
    : [];

  const hasEnabledActionsField = Array.isArray(input.enabledActions);
  const enabledActionsInput = Array.isArray(input.enabledActions)
    ? input.enabledActions.filter((action): action is AntiNukeAction => ANTINUKE_PROTECTED_ACTIONS.includes(action))
    : [];

  const rawModuleStates = input.moduleStates && typeof input.moduleStates === "object"
    ? input.moduleStates
    : {};

  const moduleStates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawModuleStates)) {
    if (!key) continue;

    if (typeof value === "boolean") {
      moduleStates[key] = value;
      continue;
    }

    // Preserve internal emergency-mode metadata stored under moduleStates.
    // These keys are consumed by panicModeStore and must survive sanitization.
    // __quarantineMembers is an object (Record), so we must allow objects too.
    if (key.startsWith("__") && (typeof value === "string" || typeof value === "number" || value === null || typeof value === "object")) {
      moduleStates[key] = value;
    }
  }

  const rawWhitelistAccess = input.whitelistAccess && typeof input.whitelistAccess === "object"
    ? input.whitelistAccess
    : {};

  const whitelistAccess: Record<string, AntiNukeWhitelistAccessProfile> = {};
  for (const [userId, profile] of Object.entries(rawWhitelistAccess)) {
    if (!userId || !profile || typeof profile !== "object") continue;

    const fullAccess = Boolean((profile as AntiNukeWhitelistAccessProfile).fullAccess);
    const rawActions = Array.isArray((profile as AntiNukeWhitelistAccessProfile).actions)
      ? (profile as AntiNukeWhitelistAccessProfile).actions
      : [];
    const actions = [...new Set(rawActions.filter((action): action is AntiNukeAction => ANTINUKE_PROTECTED_ACTIONS.includes(action)))];
    const tier = normalizeTier((profile as AntiNukeWhitelistAccessProfile).tier);
    const tierLimitThreshold = sanitizeTierLimitThreshold((profile as AntiNukeWhitelistAccessProfile).tierLimitThreshold);
    const tierLimitWindow = sanitizeTierLimitWindow((profile as AntiNukeWhitelistAccessProfile).tierLimitWindow);

    if (!fullAccess && actions.length === 0) continue;

    const normalizedProfile: AntiNukeWhitelistAccessProfile = {
      fullAccess,
      actions: fullAccess ? [...ANTINUKE_PROTECTED_ACTIONS] : actions,
    };

    if (tier) normalizedProfile.tier = tier;
    if (typeof tierLimitThreshold === "number") normalizedProfile.tierLimitThreshold = tierLimitThreshold;
    if (typeof tierLimitWindow === "number") normalizedProfile.tierLimitWindow = tierLimitWindow;
    const cmdAccess = Array.isArray((profile as AntiNukeWhitelistAccessProfile).commandAccess)
      ? (profile as AntiNukeWhitelistAccessProfile).commandAccess!.filter((k): k is string => typeof k === "string")
      : undefined;
    if (cmdAccess && cmdAccess.length > 0) normalizedProfile.commandAccess = cmdAccess;

    whitelistAccess[userId] = normalizedProfile;
  }

  // --- role whitelist sanitization ---
  const whitelistRoleIds = Array.isArray(input.whitelistRoleIds)
    ? [...new Set(input.whitelistRoleIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
    : [];

  const rawWhitelistRoleAccess = input.whitelistRoleAccess && typeof input.whitelistRoleAccess === "object"
    ? input.whitelistRoleAccess
    : {};

  const whitelistRoleAccess: Record<string, AntiNukeWhitelistAccessProfile> = {};
  for (const [roleId, profile] of Object.entries(rawWhitelistRoleAccess)) {
    if (!roleId || !profile || typeof profile !== "object") continue;

    const fullAccess = Boolean((profile as AntiNukeWhitelistAccessProfile).fullAccess);
    const rawActions = Array.isArray((profile as AntiNukeWhitelistAccessProfile).actions)
      ? (profile as AntiNukeWhitelistAccessProfile).actions
      : [];
    const actions = [...new Set(rawActions.filter((action): action is AntiNukeAction => ANTINUKE_PROTECTED_ACTIONS.includes(action)))];
    const tier = normalizeTier((profile as AntiNukeWhitelistAccessProfile).tier);
    const tierLimitThreshold = sanitizeTierLimitThreshold((profile as AntiNukeWhitelistAccessProfile).tierLimitThreshold);
    const tierLimitWindow = sanitizeTierLimitWindow((profile as AntiNukeWhitelistAccessProfile).tierLimitWindow);

    if (!fullAccess && actions.length === 0) continue;

    const normalizedProfile: AntiNukeWhitelistAccessProfile = {
      fullAccess,
      actions: fullAccess ? [...ANTINUKE_PROTECTED_ACTIONS] : actions,
    };

    if (tier) normalizedProfile.tier = tier;
    if (typeof tierLimitThreshold === "number") normalizedProfile.tierLimitThreshold = tierLimitThreshold;
    if (typeof tierLimitWindow === "number") normalizedProfile.tierLimitWindow = tierLimitWindow;
    const cmdAccess = Array.isArray((profile as AntiNukeWhitelistAccessProfile).commandAccess)
      ? (profile as AntiNukeWhitelistAccessProfile).commandAccess!.filter((k): k is string => typeof k === "string")
      : undefined;
    if (cmdAccess && cmdAccess.length > 0) normalizedProfile.commandAccess = cmdAccess;

    whitelistRoleAccess[roleId] = normalizedProfile;
  }

  // Enforce shared limit: total user + role entries <= ANTINUKE_WHITELIST_LIMIT
  const totalWhitelistEntries = whitelist.length + whitelistRoleIds.length;
  const roleSlice = totalWhitelistEntries > ANTINUKE_WHITELIST_LIMIT
    ? whitelistRoleIds.slice(0, Math.max(0, ANTINUKE_WHITELIST_LIMIT - whitelist.length))
    : whitelistRoleIds;

  // --- v2 field sanitization ---
  const rawLockdownSnapshot = input.lockdownSnapshot && typeof input.lockdownSnapshot === "object" ? input.lockdownSnapshot : {};
  const lockdownSnapshot: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawLockdownSnapshot)) {
    if (k && typeof v === "string") lockdownSnapshot[k] = v;
  }

  const rawWhitelistExpiry = input.whitelistExpiry && typeof input.whitelistExpiry === "object" ? input.whitelistExpiry : {};
  const whitelistExpiry: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawWhitelistExpiry)) {
    if (k && typeof v === "string") whitelistExpiry[k] = v;
  }

  const rawModulePunishments = input.modulePunishments && typeof input.modulePunishments === "object" ? input.modulePunishments : {};
  const modulePunishments: Record<string, AntiNukePunishment> = {};
  for (const [k, v] of Object.entries(rawModulePunishments)) {
    if (k && typeof v === "string") modulePunishments[k] = normalizePunishment(v);
  }

  const rawOffenceHistory = input.offenceHistory && typeof input.offenceHistory === "object" ? input.offenceHistory : {};
  const offenceHistory: Record<string, AntiNukeOffenceRecord> = {};
  for (const [userId, record] of Object.entries(rawOffenceHistory)) {
    if (!userId || !record || typeof record !== "object") continue;
    const r = record as Partial<AntiNukeOffenceRecord>;
    if (typeof r.count === "number" && typeof r.lastAt === "string") {
      offenceHistory[userId] = { count: Math.max(0, Math.floor(r.count)), lastAt: r.lastAt };
    }
  }

  return {
    guildId: String(input.guildId || "").trim(),
    enabled: Boolean(input.enabled),
    enabledActions: hasEnabledActionsField ? [...new Set(enabledActionsInput)] : [...ANTINUKE_PROTECTED_ACTIONS],
    moduleStates,
    extraOwnerIds,
    requiredRoleIds,
    punishment: normalizePunishment(input.punishment),
    logChannelId: typeof input.logChannelId === "string" && input.logChannelId.trim().length > 0 ? input.logChannelId : null,
    whitelistUserIds: whitelist,
    whitelistAccess,
    whitelistRoleIds: roleSlice,
    whitelistRoleAccess,
    thresholds: sanitizeThresholds(input.thresholds),
    // v2
    notifyOwner: Boolean(input.notifyOwner),
    lockdownSnapshot,
    lockdownActive: Boolean(input.lockdownActive),
    timeoutDuration: typeof input.timeoutDuration === "number" && input.timeoutDuration > 0 ? Math.floor(input.timeoutDuration) : 3_600_000,
    thresholdWindow: typeof input.thresholdWindow === "number" && input.thresholdWindow >= 1 ? Math.min(60, Math.floor(input.thresholdWindow)) : 10,
    whitelistExpiry,
    modulePunishments,
    offenceHistory,
    webhookUrl: typeof input.webhookUrl === "string" && input.webhookUrl.trim().startsWith("https://") ? input.webhookUrl.trim() : null,
    whitelistLimitsEnabled: Boolean(input.whitelistLimitsEnabled),
    whitelistLimitsThreshold: typeof input.whitelistLimitsThreshold === "number" && input.whitelistLimitsThreshold > 0 ? Math.floor(input.whitelistLimitsThreshold) : 5,
    whitelistLimitsWindow: typeof input.whitelistLimitsWindow === "number" && input.whitelistLimitsWindow > 0 ? Math.floor(input.whitelistLimitsWindow) : 60,
    whitelistLimitsPunishment: normalizePunishment(input.whitelistLimitsPunishment ?? "ban"),
    whitelistLimitsActions: Array.isArray(input.whitelistLimitsActions) ? input.whitelistLimitsActions.filter((a: any) => ANTINUKE_PROTECTED_ACTIONS.includes(a)) : [],
    whitelistLimitsBypassRoles: Array.isArray(input.whitelistLimitsBypassRoles) ? [...new Set(input.whitelistLimitsBypassRoles.filter((id): id is string => typeof id === "string" && id.trim().length > 0))] : [],
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function sanitizeIncident(input: Partial<AntiNukeIncident>): AntiNukeIncident | null {
  const action = input.action;
  if (!action || !ANTINUKE_PROTECTED_ACTIONS.includes(action)) return null;

  const guildId = String(input.guildId || "").trim();
  const executorId = String(input.executorId || "").trim();
  if (!guildId || !executorId) return null;

  return {
    id: String(input.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    guildId,
    executorId,
    action,
    punishment: normalizePunishment(input.punishment),
    contextLabel: String(input.contextLabel || "Unknown context").trim().slice(0, 120),
    threshold: typeof input.threshold === "number" ? Math.max(1, Math.floor(input.threshold)) : 1,
    targetId: input.targetId ?? null,
    recovered: Boolean(input.recovered),
    details: input.details ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

import { db } from "../../utils/database";
import { redis } from "../../infra/redis/redis";

/** Shared helper: map a DB AntiNukeConfig model row to the AntiNukeConfig interface. */
function mapDbConfig(model: {
  guildId: string; enabled: boolean; enabledActions: string[];
  moduleStates: string; extraOwnerIds: string[]; requiredRoleIds: string[];
  punishment: string; logChannelId: string | null; whitelistUserIds: string[];
  whitelistAccess: string; thresholds: string;
  whitelistRoleIds?: string[]; whitelistRoleAccess?: string;
  notifyOwner?: boolean;
  lockdownSnapshot?: string; lockdownActive?: boolean;
  timeoutDuration?: number | null; thresholdWindow?: number | null;
  whitelistExpiry?: string; modulePunishments?: string;
  offenceHistory?: string; webhookUrl?: string | null;
  whitelistLimitsEnabled?: boolean; whitelistLimitsThreshold?: number;
  whitelistLimitsWindow?: number; whitelistLimitsPunishment?: string;
  whitelistLimitsActions?: string[];
  createdAt: Date; updatedAt: Date;
}): AntiNukeConfig {
  return sanitizeConfig({
    guildId: model.guildId,
    enabled: model.enabled,
    enabledActions: model.enabledActions as AntiNukeAction[],
    moduleStates: safeJsonParse(model.moduleStates, {}),
    extraOwnerIds: model.extraOwnerIds,
    requiredRoleIds: model.requiredRoleIds,
    punishment: model.punishment as AntiNukePunishment,
    logChannelId: model.logChannelId,
    whitelistUserIds: model.whitelistUserIds,
    whitelistAccess: safeJsonParse(model.whitelistAccess, {}),
    whitelistRoleIds: model.whitelistRoleIds ?? [],
    whitelistRoleAccess: safeJsonParse(model.whitelistRoleAccess ?? "{}", {}),
    thresholds: safeJsonParse(model.thresholds, {}) as Record<AntiNukeAction, number>,
    notifyOwner: model.notifyOwner ?? false,
    lockdownSnapshot: safeJsonParse(model.lockdownSnapshot ?? "{}", {}),
    lockdownActive: model.lockdownActive ?? false,
    timeoutDuration: typeof model.timeoutDuration === "number" ? model.timeoutDuration : 3_600_000,
    thresholdWindow: typeof model.thresholdWindow === "number" ? model.thresholdWindow : 10,
    whitelistExpiry: safeJsonParse(model.whitelistExpiry ?? "{}", {}),
    modulePunishments: safeJsonParse(model.modulePunishments ?? "{}", {}),
    offenceHistory: safeJsonParse(model.offenceHistory ?? "{}", {}),
    webhookUrl: model.webhookUrl ?? null,
    whitelistLimitsEnabled: model.whitelistLimitsEnabled ?? false,
    whitelistLimitsThreshold: typeof model.whitelistLimitsThreshold === "number" ? model.whitelistLimitsThreshold : 5,
    whitelistLimitsWindow: typeof model.whitelistLimitsWindow === "number" ? model.whitelistLimitsWindow : 60,
    whitelistLimitsPunishment: normalizePunishment(model.whitelistLimitsPunishment ?? "ban"),
    whitelistLimitsActions: Array.isArray(model.whitelistLimitsActions) ? (model.whitelistLimitsActions as AntiNukeAction[]) : [],
    whitelistLimitsBypassRoles: Array.isArray((model as any).whitelistLimitsBypassRoles) ? ((model as any).whitelistLimitsBypassRoles as string[]) : [],
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  });
}

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function getAntiNukeConfig(guildId: string): Promise<AntiNukeConfig | null> {
  const cacheKey = `antinuke:config:${guildId}`;
  const cached = await redis?.get(cacheKey);
  if (cached) {
    if (cached === ANTINUKE_CONFIG_NULL_SENTINEL) return null;
    try { return JSON.parse(cached) as AntiNukeConfig; } catch { }
  }

  const model = await db.antiNukeConfig.findUnique({ where: { guildId } });
  if (!model) {
    await redis?.set(cacheKey, ANTINUKE_CONFIG_NULL_SENTINEL, "EX", ANTINUKE_CONFIG_MISS_CACHE_TTL_SECONDS);
    return null;
  }

  const config = mapDbConfig(model as any);
  await redis?.set(cacheKey, JSON.stringify(config), "EX", 3600);
  return config;
}

export async function listAllAntiNukeConfigs(): Promise<AntiNukeConfig[]> {
  const models = await db.antiNukeConfig.findMany();
  return models.map((m) => mapDbConfig(m as any));
}

export async function listAntiNukeIncidents(guildId: string, limit: number = 10): Promise<AntiNukeIncident[]> {
  const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const models = await db.antiNukeIncident.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: boundedLimit
  });

  return models.map((model) => ({
    id: model.id,
    guildId: model.guildId,
    executorId: model.executorId,
    action: model.action as AntiNukeAction,
    punishment: model.punishment as AntiNukePunishment,
    contextLabel: model.contextLabel,
    threshold: model.threshold,
    targetId: (model as any).targetId ?? null,
    recovered: Boolean((model as any).recovered),
    details: (model as any).details ?? null,
    createdAt: model.createdAt.toISOString(),
  }));
}

export async function countAntiNukeIncidentsSince(guildId: string, sinceMs: number): Promise<number> {
  return db.antiNukeIncident.count({
    where: {
      guildId,
      createdAt: { gte: new Date(sinceMs) },
    },
  });
}

export async function getAntiNukeIncidentById(id: string): Promise<AntiNukeIncident | null> {
  const model = await db.antiNukeIncident.findUnique({ where: { id } });
  if (!model) return null;
  return {
    id: model.id,
    guildId: model.guildId,
    executorId: model.executorId,
    action: model.action as AntiNukeAction,
    punishment: model.punishment as AntiNukePunishment,
    contextLabel: model.contextLabel,
    threshold: model.threshold,
    targetId: (model as any).targetId ?? null,
    recovered: Boolean((model as any).recovered),
    details: (model as any).details ?? null,
    createdAt: model.createdAt.toISOString(),
  };
}

export async function markIncidentRecovered(id: string): Promise<void> {
  await db.antiNukeIncident.update({ where: { id }, data: { recovered: true } as any }).catch(() => null);
}

export async function addAntiNukeIncident(
  incident: Omit<AntiNukeIncident, "id" | "createdAt"> & { id?: string; createdAt?: string },
): Promise<AntiNukeIncident | null> {
  const normalized = sanitizeIncident(incident);
  if (!normalized) return null;

  const model = await db.antiNukeIncident.create({
    data: {
      guildId: normalized.guildId,
      executorId: normalized.executorId,
      action: normalized.action,
      punishment: normalized.punishment,
      contextLabel: normalized.contextLabel,
      threshold: normalized.threshold,
      targetId: normalized.targetId ?? null,
      recovered: normalized.recovered ?? false,
      details: normalized.details ?? null,
      createdAt: new Date(normalized.createdAt)
    } as any
  });

  // Auto-prune old incidents in batches to avoid extra DB round-trips on every insert.
  const nextCounter = (incidentPruneCounters.get(normalized.guildId) || 0) + 1;
  incidentPruneCounters.set(normalized.guildId, nextCounter);
  const shouldCheckPrune = nextCounter >= ANTINUKE_INCIDENT_PRUNE_CHECK_EVERY;

  if (shouldCheckPrune) {
    incidentPruneCounters.set(normalized.guildId, 0);
    const totalCount = await db.antiNukeIncident.count({ where: { guildId: normalized.guildId } });
    const pruneThreshold = ANTINUKE_INCIDENTS_LIMIT + ANTINUKE_INCIDENT_PRUNE_OVERFLOW_BUFFER;

    if (totalCount > pruneThreshold) {
      const oldest = await db.antiNukeIncident.findMany({
        where: { guildId: normalized.guildId },
        orderBy: { createdAt: "asc" },
        take: totalCount - ANTINUKE_INCIDENTS_LIMIT,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await db.antiNukeIncident.deleteMany({
          where: { id: { in: oldest.map((o) => o.id) } },
        }).catch(() => null);
      }
    }
  }

  return { ...normalized, id: model.id };
}

export async function clearAntiNukeIncidents(guildId: string): Promise<number> {
  const result = await db.antiNukeIncident.deleteMany({ where: { guildId } });
  return result.count;
}

export async function upsertAntiNukeConfig(config: Partial<AntiNukeConfig> & { guildId: string }): Promise<AntiNukeConfig> {
  const normalized = sanitizeConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  });

  const v2Data = {
    notifyOwner: normalized.notifyOwner,
    lockdownSnapshot: JSON.stringify(normalized.lockdownSnapshot),
    lockdownActive: normalized.lockdownActive,
    timeoutDuration: normalized.timeoutDuration,
    thresholdWindow: normalized.thresholdWindow,
    whitelistExpiry: JSON.stringify(normalized.whitelistExpiry),
    modulePunishments: JSON.stringify(normalized.modulePunishments),
    offenceHistory: JSON.stringify(normalized.offenceHistory),
    webhookUrl: normalized.webhookUrl,
    whitelistLimitsEnabled: normalized.whitelistLimitsEnabled,
    whitelistLimitsThreshold: normalized.whitelistLimitsThreshold,
    whitelistLimitsWindow: normalized.whitelistLimitsWindow,
    whitelistLimitsPunishment: normalized.whitelistLimitsPunishment,
    whitelistLimitsActions: normalized.whitelistLimitsActions,
    whitelistLimitsBypassRoles: normalized.whitelistLimitsBypassRoles,
  };

  await db.antiNukeConfig.upsert({
    where: { guildId: normalized.guildId },
    update: {
      enabled: normalized.enabled,
      enabledActions: normalized.enabledActions,
      moduleStates: JSON.stringify(normalized.moduleStates),
      extraOwnerIds: normalized.extraOwnerIds,
      requiredRoleIds: normalized.requiredRoleIds,
      punishment: normalized.punishment,
      logChannelId: normalized.logChannelId,
      whitelistUserIds: normalized.whitelistUserIds,
      whitelistAccess: JSON.stringify(normalized.whitelistAccess),
      whitelistRoleIds: normalized.whitelistRoleIds,
      whitelistRoleAccess: JSON.stringify(normalized.whitelistRoleAccess),
      thresholds: JSON.stringify(normalized.thresholds),
      updatedAt: new Date(normalized.updatedAt),
      ...v2Data,
    } as any,
    create: {
      guildId: normalized.guildId,
      enabled: normalized.enabled,
      enabledActions: normalized.enabledActions,
      moduleStates: JSON.stringify(normalized.moduleStates),
      extraOwnerIds: normalized.extraOwnerIds,
      requiredRoleIds: normalized.requiredRoleIds,
      punishment: normalized.punishment,
      logChannelId: normalized.logChannelId,
      whitelistUserIds: normalized.whitelistUserIds,
      whitelistAccess: JSON.stringify(normalized.whitelistAccess),
      thresholds: JSON.stringify(normalized.thresholds),
      createdAt: new Date(normalized.createdAt),
      updatedAt: new Date(normalized.updatedAt),
      ...v2Data,
    } as any,
  });

  await redis?.set(`antinuke:config:${normalized.guildId}`, JSON.stringify(normalized), "EX", 3600);
  return normalized;
}

export async function updateAntiNukeConfig(guildId: string, changes: Partial<AntiNukeConfig>): Promise<AntiNukeConfig | null> {
  const existing = await getAntiNukeConfig(guildId);
  if (!existing) return null;

  const updated = sanitizeConfig({
    ...existing,
    ...changes,
    updatedAt: new Date().toISOString(),
  });

  await db.antiNukeConfig.update({
    where: { guildId },
    data: {
      enabled: updated.enabled,
      enabledActions: updated.enabledActions,
      moduleStates: JSON.stringify(updated.moduleStates),
      extraOwnerIds: updated.extraOwnerIds,
      requiredRoleIds: updated.requiredRoleIds,
      punishment: updated.punishment,
      logChannelId: updated.logChannelId,
      whitelistUserIds: updated.whitelistUserIds,
      whitelistAccess: JSON.stringify(updated.whitelistAccess),
      whitelistRoleIds: updated.whitelistRoleIds,
      whitelistRoleAccess: JSON.stringify(updated.whitelistRoleAccess),
      thresholds: JSON.stringify(updated.thresholds),
      updatedAt: new Date(updated.updatedAt),
      // v2 fields
      notifyOwner: updated.notifyOwner,
      lockdownSnapshot: JSON.stringify(updated.lockdownSnapshot),
      lockdownActive: updated.lockdownActive,
      timeoutDuration: updated.timeoutDuration,
      thresholdWindow: updated.thresholdWindow,
      whitelistExpiry: JSON.stringify(updated.whitelistExpiry),
      modulePunishments: JSON.stringify(updated.modulePunishments),
      offenceHistory: JSON.stringify(updated.offenceHistory),
      webhookUrl: updated.webhookUrl,
      whitelistLimitsEnabled: updated.whitelistLimitsEnabled,
      whitelistLimitsThreshold: updated.whitelistLimitsThreshold,
      whitelistLimitsWindow: updated.whitelistLimitsWindow,
      whitelistLimitsPunishment: updated.whitelistLimitsPunishment,
      whitelistLimitsActions: updated.whitelistLimitsActions,
      whitelistLimitsBypassRoles: updated.whitelistLimitsBypassRoles,
    } as any,
  });

  await redis?.set(`antinuke:config:${guildId}`, JSON.stringify(updated), "EX", 3600);
  return updated;
}

// ────────────────────────────────────────────────────────────────
// AntiNuke Audit Trail CRUD
// ────────────────────────────────────────────────────────────────

export async function addAntiNukeAudit(
  guildId: string,
  actorId: string,
  command: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await (db as any).antiNukeAudit.create({
    data: {
      guildId,
      actorId,
      command,
      details: JSON.stringify(details),
    },
  }).catch(() => null);
}

export async function listAntiNukeAudit(guildId: string, limit: number = 20): Promise<AntiNukeAudit[]> {
  const boundedLimit = Math.min(100, Math.max(1, limit));
  const models = await (db as any).antiNukeAudit.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: boundedLimit,
  }).catch(() => []) as any[];

  return models.map((m: any) => ({
    id: m.id,
    guildId: m.guildId,
    actorId: m.actorId,
    command: m.command,
    details: (() => { try { return JSON.parse(m.details || "{}"); } catch { return {}; } })(),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  }));
}

export async function clearAntiNukeAudit(guildId: string): Promise<number> {
  const result = await (db as any).antiNukeAudit.deleteMany({ where: { guildId } }).catch(() => ({ count: 0 }));
  return result.count;
}

/**
 * Remove all AntiNuke persisted data for a guild.
 * Intended for premium-expiry cleanup flows (not guild leave events).
 */
export async function removeAntiNukeGuildData(guildId: string): Promise<void> {
  await db.antiNukeConfig.deleteMany({ where: { guildId } }).catch(() => null);
  await db.antiNukeIncident.deleteMany({ where: { guildId } }).catch(() => null);
  await (db as any).antiNukeAudit.deleteMany({ where: { guildId } }).catch(() => null);
  await redis?.del(`antinuke:config:${guildId}`).catch(() => null);
}
