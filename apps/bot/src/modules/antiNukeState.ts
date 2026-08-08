import type { AntiNuke, AntiNukeMember, ID } from "@repo/db";

export const ANTI_NUKE_MODULES = ["channel", "role", "member", "emoji", "webhook", "sticker", "guild"] as const;
export type AntiNukeModuleKey = typeof ANTI_NUKE_MODULES[number];

export const ANTI_NUKE_AUDIT_MAX_AGE_MS = 30_000;

export function isFreshAntiNukeAuditEntry(createdTimestamp: number, now = Date.now()): boolean {
	return Number.isFinite(createdTimestamp) && createdTimestamp <= now + 5_000 && now - createdTimestamp <= ANTI_NUKE_AUDIT_MAX_AGE_MS;
}

export function isMatchingFreshAntiNukeAuditEntry(
	expectedTargetId: string,
	actualTargetId: string | undefined,
	createdTimestamp: number,
	now = Date.now(),
): boolean {
	return actualTargetId === expectedTargetId && isFreshAntiNukeAuditEntry(createdTimestamp, now);
}

export function normalizeTrustedUsers(value: unknown): ID[] {
	if (!Array.isArray(value)) return [];
	const ids = value
		.map((entry) => typeof entry === "string" ? entry : (entry as { id?: unknown })?.id)
		.filter((id): id is string => typeof id === "string" && isDiscordSnowflake(id));
	return [...new Set(ids)].map((id) => ({ id }));
}

export function isDiscordSnowflake(value: string): boolean {
	return /^\d{17,20}$/.test(value);
}

export function parseDiscordUserId(value: string | undefined): string | null {
	if (!value) return null;
	const match = value.trim().match(/^<@!?(\d{17,20})>$|^(\d{17,20})$/);
	return match?.[1] ?? match?.[2] ?? null;
}

export function addTrustedUser(value: unknown, userId: string): ID[] {
	const users = normalizeTrustedUsers(value);
	return users.some((user) => user.id === userId) ? users : [...users, { id: userId }];
}

export function removeTrustedUser(value: unknown, userId: string): ID[] {
	return normalizeTrustedUsers(value).filter((user) => user.id !== userId);
}

export function buildSafeDefaultAntiNukePatch(): Partial<AntiNuke> {
	const entry = (type: string) => ({ type, enabled: true, limit: 1, action: "ban" as const });
	return {
		enabled: true,
		mention: true,
		gateKeeper: true,
		channel: [entry("create"), entry("delete"), entry("update")],
		role: [entry("create"), entry("delete"), entry("update")],
		member: [entry("kick"), entry("ban"), entry("unban"), entry("update"), {
			type: "infiniteVoid",
			enabled: true,
			limit: 50,
			action: "ban" as const,
		}],
		emoji: [entry("create"), entry("delete"), entry("update")],
		webhook: [entry("create"), entry("delete"), entry("update")],
		sticker: [entry("create"), entry("delete"), entry("update")],
		guild: [entry("update")],
	} as Partial<AntiNuke>;
}

export function buildDisabledAntiNukePatch(settings: AntiNuke): Partial<AntiNuke> {
	const patch: Partial<AntiNuke> = { enabled: false, mention: false, gateKeeper: false };
	for (const key of ANTI_NUKE_MODULES) {
		patch[key] = settings[key].map((entry) => ({ ...entry, enabled: false })) as never;
	}
	return patch;
}

export function moduleIsEnabled(settings: AntiNuke, key: AntiNukeModuleKey): boolean {
	return settings.enabled && settings[key].some((entry) => entry.enabled && entry.type !== "infiniteVoid");
}

export function infiniteVoidIsEnabled(settings: AntiNuke): boolean {
	return settings.enabled && settings.member.some((entry) => entry.type === "infiniteVoid" && entry.enabled);
}

export function setInfiniteVoidEnabled(settings: AntiNuke, enabled: boolean): AntiNukeMember[] {
	const entries = settings.member.filter((entry) => entry.type !== "infiniteVoid");
	return [...entries, { type: "infiniteVoid", enabled, limit: 50, action: "ban" }];
}

export function isAntiNukeBypassed(settings: AntiNuke, ownerId: string, botId: string | undefined, userId: string): boolean {
	return !settings.enabled || userId === ownerId || userId === botId || userId === settings.admin ||
		normalizeTrustedUsers(settings.trustedUsers).some((user) => user.id === userId);
}

export function clearLocalAntiNukeCaches(
	guildId: string,
	configs: Map<string, AntiNuke>,
	actions: Map<string, unknown>,
): void {
	configs.delete(guildId);
	const prefix = `${guildId}:`;
	for (const key of actions.keys()) if (key.startsWith(prefix)) actions.delete(key);
}
