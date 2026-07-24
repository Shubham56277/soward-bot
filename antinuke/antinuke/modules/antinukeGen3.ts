import { GuildMember, User, UserFlagsBitField } from "discord.js";
import type { Bot } from "../../core/client";
import {
  addAntiNukeAudit,
  getAntiNukeConfig,
  updateAntiNukeConfig,
  type AntiNukeConfig,
  type AntiNukePunishment,
} from "../client/antinukeStore";
import { isGuildPremiumActive, getPremiumGuildIds } from "../../utils/premiumGuard";
import { applyAntiNukeMemberPunishment, sendIncidentLog } from "../client/antinukeRuntime";
import logger from "../../utils/logger";

export const GEN3_STATE_KEY = "__gen3_v1";

export type Gen3ModuleKey =
  | "suspicious_account"
  | "advertising_name"
  | "account_age"
  | "no_avatar"
  | "username_filter";

export type Gen3AgeUnit = "minutes" | "hours" | "days" | "weeks";

export interface Gen3ModuleCore {
  enabled: boolean;
  punishment: AntiNukePunishment;
  /** Per-module owner / log bell — uses global notify when true */
  alerts: boolean;
}

export interface Gen3AccountAgeModule extends Gen3ModuleCore {
  minAgeValue: number;
  minAgeUnit: Gen3AgeUnit;
}

export interface Gen3UsernameModule extends Gen3ModuleCore {
  /** Also scan when nickname / profile name changes after join */
  postJoin: boolean;
  strictWords: string[];
  wildcardWords: string[];
}

export interface Gen3Config {
  masterEnabled: boolean;
  suspicious_account: Gen3ModuleCore;
  advertising_name: Gen3ModuleCore;
  account_age: Gen3AccountAgeModule;
  no_avatar: Gen3ModuleCore;
  username_filter: Gen3UsernameModule;
}

const ADVERTISING_PATTERN =
  /(discord(?:app)?\.com\s*\/\s*invite|discord\.gg\/|dsc\.gg\/|\.gg\/invite|\/invite\/)/i;

const DEFAULT_CORE = (punishment: AntiNukePunishment = "kick"): Gen3ModuleCore => ({
  enabled: false,
  punishment,
  alerts: true,
});

export function defaultGen3Config(): Gen3Config {
  return {
    masterEnabled: false,
    suspicious_account: { ...DEFAULT_CORE("kick"), enabled: false },
    advertising_name: { ...DEFAULT_CORE("kick"), enabled: false },
    account_age: {
      ...DEFAULT_CORE("kick"),
      enabled: false,
      minAgeValue: 7,
      minAgeUnit: "days",
    },
    no_avatar: { ...DEFAULT_CORE("kick"), enabled: false },
    username_filter: {
      ...DEFAULT_CORE("ban"),
      enabled: false,
      postJoin: false,
      strictWords: [],
      wildcardWords: [],
    },
  };
}

function normalizePunishment(raw: unknown): AntiNukePunishment {
  const s = typeof raw === "string" ? raw : "";
  return s === "warn"
    || s === "ban"
    || s === "kick"
    || s === "timeout"
    || s === "quarantine"
    || s === "rolestrip"
    || s === "staged"
    ? s
    : "kick";
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeAgeUnit(raw: unknown): Gen3AgeUnit {
  const u = typeof raw === "string" ? raw.toLowerCase() : "";
  if (u === "minutes" || u === "hours" || u === "days" || u === "weeks") return u;
  return "days";
}

function normalizeWordList(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, 40);
    if (t.length === 0) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function parseGen3Config(states: Record<string, unknown> | undefined | null): Gen3Config {
  const base = defaultGen3Config();
  if (!states || typeof states !== "object") return base;

  const blob = states[GEN3_STATE_KEY];
  let parsed: unknown = blob;
  if (typeof blob === "string") {
    try {
      parsed = JSON.parse(blob);
    } catch {
      return base;
    }
  }
  if (!parsed || typeof parsed !== "object") return base;
  const o = parsed as Record<string, unknown>;

  base.masterEnabled = o.masterEnabled === true;

  const patchCore = (key: Gen3ModuleKey, target: Gen3ModuleCore) => {
    const m = o[key];
    if (!m || typeof m !== "object") return;
    const r = m as Record<string, unknown>;
    if (typeof r.enabled === "boolean") target.enabled = r.enabled;
    target.punishment = normalizePunishment(r.punishment);
    if (typeof r.alerts === "boolean") target.alerts = r.alerts;
  };

  patchCore("suspicious_account", base.suspicious_account);
  patchCore("advertising_name", base.advertising_name);
  patchCore("no_avatar", base.no_avatar);
  patchCore("account_age", base.account_age);
  if (typeof o.account_age === "object" && o.account_age) {
    const a = o.account_age as Record<string, unknown>;
    if (typeof a.minAgeValue === "number" && Number.isFinite(a.minAgeValue)) {
      base.account_age.minAgeValue = clampInt(a.minAgeValue, 1, 365);
    }
    base.account_age.minAgeUnit = normalizeAgeUnit(a.minAgeUnit);
  }
  patchCore("username_filter", base.username_filter);
  if (typeof o.username_filter === "object" && o.username_filter) {
    const u = o.username_filter as Record<string, unknown>;
    if (typeof u.postJoin === "boolean") base.username_filter.postJoin = u.postJoin;
    base.username_filter.strictWords = normalizeWordList(u.strictWords, 25);
    base.username_filter.wildcardWords = normalizeWordList(u.wildcardWords, 25);
  }

  return base;
}

export function serializeGen3ToStates(
  existing: Record<string, unknown> | undefined | null,
  gen3: Gen3Config,
): Record<string, unknown> {
  const next = { ...(existing && typeof existing === "object" ? existing : {}) } as Record<string, unknown>;
  next[GEN3_STATE_KEY] = JSON.stringify(gen3);
  return next;
}

export async function persistGen3Config(guildId: string, config: AntiNukeConfig, gen3: Gen3Config): Promise<AntiNukeConfig | null> {
  const moduleStates = serializeGen3ToStates(
    config.moduleStates && typeof config.moduleStates === "object" ? (config.moduleStates as Record<string, unknown>) : {},
    gen3,
  );
  return updateAntiNukeConfig(guildId, { moduleStates: moduleStates as any });
}

export function gen3AgeToMs(unit: Gen3AgeUnit, value: number): number {
  const v = clampInt(value, 1, 10_000);
  switch (unit) {
    case "minutes":
      return v * 60_000;
    case "hours":
      return v * 3_600_000;
    case "days":
      return v * 86_400_000;
    case "weeks":
      return v * 7 * 86_400_000;
    default:
      return v * 86_400_000;
  }
}

/** True if account is younger than configured minimum (must be punished). */
export function accountViolatesMinAge(createdTimestamp: number, mod: Gen3AccountAgeModule): boolean {
  const minMs = gen3AgeToMs(mod.minAgeUnit, mod.minAgeValue);
  return Date.now() - createdTimestamp < minMs;
}

export function userHasAdvertisingName(user: User, nick: string | null): boolean {
  const blob = `${user.username} ${user.globalName ?? ""} ${nick ?? ""}`.toLowerCase();
  return ADVERTISING_PATTERN.test(blob);
}

export function userHasNoAvatar(user: User): boolean {
  return user.avatar == null;
}

export function userLooksSuspicious(user: User): boolean {
  try {
    const flags = user.flags;
    const F = UserFlagsBitField.Flags;
    if (flags?.has(F.Spammer)) return true;
    if (flags?.has(F.Quarantined as unknown as number)) return true;
  } catch {
    /* ignore */
  }

  const age = Date.now() - user.createdTimestamp;
  if (age < 48 * 3_600_000) return true;

  const u = user.username;
  if (u.length >= 10) {
    const digits = (u.match(/\d/g) || []).length;
    if (digits >= u.length * 0.55) return true;
  }

  if (/^(.)\1{6,}$/i.test(u)) return true;

  const nonAlnum = (u.match(/[^a-zA-Z0-9]/g) || []).length;
  if (u.length >= 12 && nonAlnum / u.length > 0.62) return true;

  return false;
}

function wildcardToRegex(pattern: string): RegExp | null {
  const parts = pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (parts.length === 1) {
    try {
      return new RegExp(parts[0], "i");
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(parts.join(".*"), "i");
  } catch {
    return null;
  }
}

export function usernameFilterMatches(mod: Gen3UsernameModule, user: User, nick: string | null): boolean {
  const hay = `${user.username} ${user.globalName ?? ""} ${nick ?? ""}`.toLowerCase();

  for (const w of mod.strictWords) {
    if (w.length > 0 && hay.includes(w.toLowerCase())) return true;
  }

  for (const w of mod.wildcardWords) {
    const rx = wildcardToRegex(w.trim());
    if (rx && rx.test(hay)) return true;
  }

  return false;
}

export function isGen3Bypass(member: GuildMember, config: AntiNukeConfig, botUserId: string | undefined): boolean {
  const guild = member.guild;
  const userId = member.id;
  if (userId === guild.ownerId) return true;
  if (member.user.bot) return true;
  if (botUserId && userId === botUserId) return true;
  if (Array.isArray(config.extraOwnerIds) && config.extraOwnerIds.includes(userId)) return true;

  const whitelistAction = "linkRole";
  const profile = config.whitelistAccess?.[userId];
  const isWhitelistedUser =
    Boolean(profile?.fullAccess)
    || Boolean(profile && Array.isArray(profile.actions) && profile.actions.includes(whitelistAction as never))
    || (Array.isArray(config.whitelistUserIds) && config.whitelistUserIds.includes(userId));

  const hasLegacyWhitelistedRole = Boolean(
    Array.isArray(config.whitelistRoleIds)
      && config.whitelistRoleIds.some((roleId) => member.roles.cache.has(roleId)),
  );
  const hasProfileWhitelistedRole = Boolean(
    config.whitelistRoleAccess
      && Object.entries(config.whitelistRoleAccess).some(([roleId, roleProfile]) => {
        if (!member.roles.cache.has(roleId)) return false;
        if (!roleProfile || typeof roleProfile !== "object") return false;
        const full = Boolean((roleProfile as { fullAccess?: boolean }).fullAccess);
        const actions: string[] = Array.isArray((roleProfile as { actions?: string[] }).actions)
          ? (roleProfile as { actions: string[] }).actions
          : [];
        return full || actions.includes(whitelistAction);
      }),
  );

  return isWhitelistedUser || hasLegacyWhitelistedRole || hasProfileWhitelistedRole;
}

const MODULE_LABEL: Record<Gen3ModuleKey, string> = {
  suspicious_account: "Suspicious account",
  advertising_name: "Advertising name",
  account_age: "Account age",
  no_avatar: "No avatar",
  username_filter: "Username filter",
};

async function notifyOwnerGen3(
  guild: GuildMember["guild"],
  config: AntiNukeConfig,
  title: string,
  lines: string[],
): Promise<void> {
  if (!config.notifyOwner) return;
  try {
    const owner = await guild.fetchOwner();
    await owner.send({
      content: [title, "", ...lines].join("\n"),
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    }).catch(() => null);
  } catch {
    /* ignore */
  }
}

type Hit = { key: Gen3ModuleKey; detail: string };

function evaluateGen3JoinHits(user: User, nick: string | null, gen3: Gen3Config): Hit[] {
  const hits: Hit[] = [];
  if (gen3.suspicious_account.enabled && userLooksSuspicious(user)) {
    hits.push({ key: "suspicious_account", detail: "Heuristic / account flags matched suspicious profile." });
  }
  if (gen3.advertising_name.enabled && userHasAdvertisingName(user, nick)) {
    hits.push({ key: "advertising_name", detail: "Invite or promo pattern detected in name." });
  }
  if (gen3.account_age.enabled && accountViolatesMinAge(user.createdTimestamp, gen3.account_age)) {
    hits.push({
      key: "account_age",
      detail: `Account younger than **${gen3.account_age.minAgeValue}** ${gen3.account_age.minAgeUnit}.`,
    });
  }
  if (gen3.no_avatar.enabled && userHasNoAvatar(user)) {
    hits.push({ key: "no_avatar", detail: "User has no custom avatar." });
  }
  if (gen3.username_filter.enabled && usernameFilterMatches(gen3.username_filter, user, nick)) {
    hits.push({ key: "username_filter", detail: "Strict or wildcard word matched." });
  }
  return hits;
}

function evaluateUsernameFilterOnly(user: User, nick: string | null, gen3: Gen3Config): Hit | null {
  if (!gen3.masterEnabled || !gen3.username_filter.enabled || !gen3.username_filter.postJoin) return null;
  if (!usernameFilterMatches(gen3.username_filter, user, nick)) return null;
  return { key: "username_filter", detail: "Strict or wildcard word matched (post-join update)." };
}

async function applyGen3Hit(
  client: Bot,
  member: GuildMember,
  config: AntiNukeConfig,
  hit: Hit,
  gen3: Gen3Config,
): Promise<boolean> {
  const mod = gen3[hit.key];
  const punishment = mod.punishment;
  const reason = `AntiNuke 3rd Gen — ${MODULE_LABEL[hit.key]}`;

  await applyAntiNukeMemberPunishment(
    member.guild,
    member.id,
    punishment,
    reason,
    config.timeoutDuration ?? 3_600_000,
    member,
  );

  await addAntiNukeAudit(member.guild.id, client.user?.id ?? "0", "gen3 enforcement", {
    module: hit.key,
    punishment,
    detail: hit.detail,
    source: "join_or_profile",
  }).catch(() => null);

  const modAlerts = "alerts" in mod ? mod.alerts : true;
  if (modAlerts && config.notifyOwner) {
    await notifyOwnerGen3(member.guild, config, "**AntiNuke 3rd Gen**", [
      `**Server:** ${member.guild.name}`,
      `**Module:** ${MODULE_LABEL[hit.key]}`,
      `**Member:** <@${member.id}> (\`${member.id}\`)`,
      `**Punishment:** ${punishment}`,
      hit.detail,
    ]);
  }

  await sendIncidentLog(
    member.guild,
    config.logChannelId,
    `3rd Gen · ${MODULE_LABEL[hit.key]}`,
    [
      `**Member:** <@${member.id}> (\`${member.id}\`)`,
      `**Punishment:** ${punishment}`,
      hit.detail,
    ].join("\n"),
    { executorId: member.id, punishment },
  ).catch(() => null);

  return punishment === "ban" || punishment === "kick";
}

/**
 * Run all enabled Gen3 join checks. Returns true if member was kicked or banned (caller may skip noisy join tasks).
 */
export async function runGen3JoinGate(client: Bot, member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;

  try {
    const premium = await isGuildPremiumActive(member.guild.id);
    if (!premium) return false;

    const config = await getAntiNukeConfig(member.guild.id);
    if (!config?.enabled) return false;

    const states = config.moduleStates && typeof config.moduleStates === "object"
      ? (config.moduleStates as Record<string, unknown>)
      : {};
    const gen3 = parseGen3Config(states);
    if (!gen3.masterEnabled) return false;

    if (isGen3Bypass(member, config, client.user?.id)) return false;

    const hits = evaluateGen3JoinHits(member.user, member.nickname, gen3);
    if (hits.length === 0) return false;

    const hit = hits[0];
    return await applyGen3Hit(client, member, config, hit, gen3);
  } catch (e) {
    logger.debug(`[ ANTINUKE GEN3 ] join gate ${member.guild.id}: ${e}`);
  }

  return false;
}

export async function runGen3UserProfileEnforcement(client: Bot, oldUser: User, newUser: User): Promise<void> {
  if (newUser.bot) return;

  const nameChanged =
    oldUser.username !== newUser.username
    || (oldUser.globalName ?? "") !== (newUser.globalName ?? "");
  if (!nameChanged) return;

  // Pre-fetch premium guild set once — avoids 20K individual Redis lookups
  const premiumIds = await getPremiumGuildIds();

  for (const guild of client.guilds.cache.values()) {
    if (!premiumIds.has(guild.id)) continue;

    const member = guild.members.cache.get(newUser.id);
    if (!member) continue;

    try {
      const config = await getAntiNukeConfig(guild.id);
      if (!config?.enabled) continue;

      const gen3 = parseGen3Config(
        config.moduleStates && typeof config.moduleStates === "object"
          ? (config.moduleStates as Record<string, unknown>)
          : {},
      );
      if (!gen3.masterEnabled) continue;
      if (isGen3Bypass(member, config, client.user?.id)) continue;

      const hit = evaluateUsernameFilterOnly(newUser, member.nickname, gen3);
      if (!hit) continue;

      await applyGen3Hit(client, member, config, hit, gen3);
    } catch (e) {
      logger.debug(`[ ANTINUKE GEN3 ] userUpdate ${guild.id}/${newUser.id}: ${e}`);
    }
  }
}

export async function runGen3MemberDisplayEnforcement(client: Bot, oldMember: GuildMember, newMember: GuildMember): Promise<void> {
  if (newMember.user.bot) return;

  const oldNick = oldMember.nickname;
  const newNick = newMember.nickname;
  if (oldNick === newNick) return;

  try {
    const premium = await isGuildPremiumActive(newMember.guild.id);
    if (!premium) return;

    const config = await getAntiNukeConfig(newMember.guild.id);
    if (!config?.enabled) return;

    const gen3 = parseGen3Config(
      config.moduleStates && typeof config.moduleStates === "object"
        ? (config.moduleStates as Record<string, unknown>)
        : {},
    );
    if (!gen3.masterEnabled) return;
    if (isGen3Bypass(newMember, config, client.user?.id)) return;

    const hit = evaluateUsernameFilterOnly(newMember.user, newMember.nickname, gen3);
    if (!hit) return;

    await applyGen3Hit(client, newMember, config, hit, gen3);
  } catch (e) {
    logger.debug(`[ ANTINUKE GEN3 ] memberUpdate ${newMember.guild.id}: ${e}`);
  }
}

export { MODULE_LABEL as GEN3_MODULE_LABEL };
