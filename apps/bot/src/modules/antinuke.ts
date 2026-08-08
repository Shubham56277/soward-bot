import { AntiNuke, AntiNukeChannel, AntiNukeMember, AuditLogger } from "@repo/db";
import BaseClient from "../base/Client";
import { Guild, GuildMember, Routes } from "discord.js";
import {
    clearLocalAntiNukeCaches,
    isAntiNukeBypassed,
    isFreshAntiNukeAuditEntry,
    normalizeTrustedUsers,
    removeTrustedUser,
} from "./antiNukeState";

const getActionKey = (g: string, u: string, a: string) => `${g}:${u}:${a}`;
const getConfigKey = (g: string) => `c:${g}`;
const localPunishmentLocks = new Set<string>();

export const INFINITE_VOID_THRESHOLD = 50;
export const INFINITE_VOID_WINDOW_MS = 20 * 60 * 1000;
const INFINITE_VOID_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const INFINITE_VOID_AUDIT_MAX_AGE_MS = 30_000;
const INFINITE_VOID_COUNTER_TTL_SECONDS = Math.ceil(INFINITE_VOID_WINDOW_MS / 1000) + 60;
const INFINITE_VOID_MAX_EVENTS = 200;

export type InfiniteVoidKickResult = {
    counted: boolean;
    count: number;
    thresholdReached: boolean;
    incidentAcquired: boolean;
    punished: boolean;
    action?: "ban" | "rolestrip-timeout" | "rolestrip" | "timeout" | "none";
};

const INFINITE_VOID_COUNTER_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local added = redis.call("ZADD", KEYS[1], "NX", ARGV[2], ARGV[3])
local count = redis.call("ZCARD", KEYS[1])
if count > tonumber(ARGV[5]) then
  redis.call("ZREMRANGEBYRANK", KEYS[1], 0, count - tonumber(ARGV[5]) - 1)
  count = redis.call("ZCARD", KEYS[1])
end
redis.call("EXPIRE", KEYS[1], ARGV[4])
return { added, count }
`;

const REVOKE_EXTRA_OWNER_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, owners = pcall(cjson.decode, raw)
if not ok or type(owners) ~= "table" then return redis.error_reply("invalid extra owner data") end
local kept = {}
local removed = 0
for _, owner in ipairs(owners) do
  if owner.userId == ARGV[1] then removed = removed + 1 else table.insert(kept, owner) end
end
if removed > 0 then redis.call("SET", KEYS[1], cjson.encode(kept)) end
return removed
`;

export class AntiNukeService {
    private readonly actionExpiry = 45;
    private readonly configTtlMs = 30_000;
    private readonly lockTtl = 20;

    private configs = new Map<string, AntiNuke>();
    private configExpiry = new Map<string, number>();
    private locks = localPunishmentLocks;
    private actions = new Map<string, [number, number]>(); // [count, expires]

    constructor(private client: BaseClient) { }

    private logError(operation: string, error: unknown, context: Record<string, unknown> = {}): void {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.client.logger.error(`[AntiNuke] ${operation} failed ${JSON.stringify(context)}: ${detail}`);
    }

    syncGuildConfig(guildId: string, next: AntiNuke): AntiNuke {
        const normalized = new AntiNuke(guildId, {
            ...next,
            trustedUsers: normalizeTrustedUsers(next.trustedUsers),
        });
        const current = this.configs.get(guildId);
        if (current) Object.assign(current, normalized);
        else this.configs.set(guildId, normalized);
        this.configExpiry.set(guildId, Date.now() + this.configTtlMs);
        return current ?? normalized;
    }

    private async refreshConfig(guildId: string, operation: string): Promise<AntiNuke | null> {
        try {
            const config = await AntiNuke.get(guildId);
            config.trustedUsers = normalizeTrustedUsers(config.trustedUsers);
            return this.syncGuildConfig(guildId, config);
        } catch (error) {
            this.logError(operation, error, { guildId });
            return null;
        }
    }

    async isBypassed(guild: Guild, userId: string): Promise<boolean> {
        const config = await this.refreshConfig(guild.id, "bypass-config-refresh");
        if (!config) return true;
        return isAntiNukeBypassed(config, guild.ownerId, this.client.user?.id, userId);
    }

    // Instant cache clearing
    clearUserActions(g: string, u: string): void {
        const prefix = `${g}:${u}:`;
        for (const key of this.actions.keys()) {
            if (key.startsWith(prefix)) this.actions.delete(key);
        }
		void this.deleteKeysByPrefix(prefix);
    }

    async invalidateGuild(guildId: string, next?: AntiNuke): Promise<void> {
        const current = this.configs.get(guildId);
        if (current && next) {
            Object.assign(current, new AntiNuke(guildId, {
                ...next,
                trustedUsers: normalizeTrustedUsers(next.trustedUsers),
            }));
        }
        clearLocalAntiNukeCaches(guildId, this.configs, this.actions);
        this.configExpiry.delete(guildId);
        await Promise.all([
            this.client.redis.del(getConfigKey(guildId)),
            this.deleteKeysByPrefix(`${guildId}:`),
        ]).catch(error => this.logError("guild-cache-invalidate", error, { guildId }));
    }

    clearGuildConfig(guildId: string): void {
        void this.invalidateGuild(guildId);
    }

    clearAllActions(guildId: string): void {
        const prefix = `${guildId}:`;
        for (const key of this.actions.keys()) {
            if (key.startsWith(prefix)) this.actions.delete(key);
        }
        void this.deleteKeysByPrefix(prefix);
    }

    async getConfig(g: string): Promise<AntiNuke> {
        const existing = this.configs.get(g);
        if (existing && (this.configExpiry.get(g) ?? 0) > Date.now()) return existing;
        this.configs.delete(g);
        this.configExpiry.delete(g);

        const key = getConfigKey(g);
        try {
            const cached = await this.client.redis.get(key);
            if (cached) {
                const config = new AntiNuke(g, JSON.parse(cached));
                config.trustedUsers = normalizeTrustedUsers(config.trustedUsers);
                return this.syncGuildConfig(g, config);
            }
        } catch (error) {
            this.logError("config-cache-read", error, { guildId: g });
        }

        const config = await AntiNuke.get(g);
        config.trustedUsers = normalizeTrustedUsers(config.trustedUsers);
        this.syncGuildConfig(g, config);

        process.nextTick(() => {
            this.client.redis.setex(key, 180, JSON.stringify(config)).catch(error => {
                this.logError("config-cache-write", error, { guildId: g });
            });
        });
        return config;
    }

    async trackAction(guild: Guild, u: string, actionType: string, actionConfig: AntiNukeChannel | AntiNukeMember): Promise<boolean> {
        if (await this.isBypassed(guild, u)) return false;

        const key = getActionKey(guild.id, u, actionType);
        const now = Date.now();
        const cached = this.actions.get(key);
        if (cached && cached[1] > now) {
            cached[0]++;
            process.nextTick(() => {
                this.client.redis.multi().incr(key).expire(key, this.actionExpiry).exec().catch(error => {
                    this.logError("action-counter-update", error, { guildId: guild.id, userId: u, actionType });
                });
            });
            return cached[0] >= actionConfig.limit;
        }

        try {
            const count = await this.client.redis.eval(
                'local c = redis.call("INCR", KEYS[1]); redis.call("EXPIRE", KEYS[1], ARGV[1]); return c',
                1, key, this.actionExpiry.toString()
            ) as number;

            this.actions.set(key, [count, now + this.actionExpiry * 1000]);
            this.pruneActions(now);
            return count >= actionConfig.limit;
        } catch (error) {
            this.logError("action-counter-increment", error, { guildId: guild.id, userId: u, actionType });
            const count = (cached?.[0] || 0) + 1;
            this.actions.set(key, [count, now + this.actionExpiry * 1000]);
            return count >= actionConfig.limit;
        }
    }

	private pruneActions(now: number): void {
		if (this.actions.size < 50_000) return;
		for (const [key, value] of this.actions) {
			if (value[1] <= now) this.actions.delete(key);
		}
	}

    private async deleteKeysByPrefix(prefix: string): Promise<void> {
        let cursor = "0";
        do {
            let keys: string[] = [];
            try {
                const result = await this.client.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
                cursor = result[0];
                keys = result[1];
                if (keys.length) await this.client.redis.unlink(...keys);
            } catch (error) {
                this.logError("action-cache-clear", error, { prefix });
                return;
            }
        } while (cursor !== "0");
    }

    async cleanupChannel(guild: Guild, userId: string, channelId: string): Promise<boolean> {
        const config = await this.refreshConfig(guild.id, "cleanup-config-refresh");
        if (!config || isAntiNukeBypassed(config, guild.ownerId, this.client.user?.id, userId)) return false;

        try {
            await this.client.rest.delete(Routes.channel(channelId));
            return true;
        } catch (error) {
            this.logError("channel-cleanup", error, { guildId: guild.id, userId, channelId });
            return false;
        }
    }

    async clearWhitelistState(guildId: string, userId?: string): Promise<void> {
        if (userId) {
            const actionPrefix = `${guildId}:${userId}:`;
            for (const key of this.actions.keys()) {
                if (key.startsWith(actionPrefix)) this.actions.delete(key);
            }
            await Promise.all([
                this.client.redis.del(`wl:actions:${guildId}:${userId}`),
                this.deleteKeysByPrefix(actionPrefix),
            ]).catch(error => this.logError("whitelist-state-clear", error, { guildId, userId }));
            return;
        }

        const actionPrefix = `${guildId}:`;
        for (const key of this.actions.keys()) {
            if (key.startsWith(actionPrefix)) this.actions.delete(key);
        }
        await Promise.all([
            this.deleteKeysByPrefix(actionPrefix),
            this.deleteKeysByPrefix(`wl:actions:${guildId}:`),
        ]).catch(error => this.logError("whitelist-state-reset", error, { guildId }));
    }

    async recordInfiniteVoidKick(
        guild: Guild,
        executorId: string,
        targetId: string,
        auditEntryId: string,
        auditCreatedTimestamp: number,
        now = Date.now(),
    ): Promise<InfiniteVoidKickResult> {
        const skipped: InfiniteVoidKickResult = {
            counted: false,
            count: 0,
            thresholdReached: false,
            incidentAcquired: false,
            punished: false,
        };
        const config = await this.refreshConfig(guild.id, "infinite-void-config-refresh");
        const moduleEnabled = config?.member.some(entry => entry.type === "infiniteVoid" && entry.enabled);
        if (!config?.enabled || !moduleEnabled) return skipped;
        if (executorId === guild.ownerId || executorId === this.client.user?.id) return skipped;
        if (!targetId || !auditEntryId || auditCreatedTimestamp > now + 5_000 || now - auditCreatedTimestamp > INFINITE_VOID_AUDIT_MAX_AGE_MS) {
            this.client.logger.warn(`[AntiNuke] infinite-void-audit-rejected ${JSON.stringify({
                guildId: guild.id,
                executorId,
                targetId,
                auditEntryId,
                auditCreatedTimestamp,
                now,
            })}`);
            return skipped;
        }

        const counterKey = `antinuke:infinite-void:kicks:${guild.id}:${executorId}`;
        let counted = false;
        let count = 0;
        try {
            const result = await this.client.redis.eval(
                INFINITE_VOID_COUNTER_SCRIPT,
                1,
                counterKey,
                String(now - INFINITE_VOID_WINDOW_MS),
                String(auditCreatedTimestamp),
                auditEntryId,
                String(INFINITE_VOID_COUNTER_TTL_SECONDS),
                String(INFINITE_VOID_MAX_EVENTS),
            ) as [number | string, number | string];
            counted = Number(result?.[0]) === 1;
            count = Number(result?.[1]) || 0;
        } catch (error) {
            this.logError("infinite-void-counter", error, { guildId: guild.id, executorId, targetId, auditEntryId });
            return skipped;
        }

        const thresholdReached = count >= INFINITE_VOID_THRESHOLD;
        const result: InfiniteVoidKickResult = {
            counted,
            count,
            thresholdReached,
            incidentAcquired: false,
            punished: false,
        };
        if (!thresholdReached) return result;

        const incidentKey = `antinuke:infinite-void:incident:${guild.id}:${executorId}`;
        try {
            const acquired = await this.client.redis.set(
                incidentKey,
                auditEntryId,
                "EX",
                Math.ceil(INFINITE_VOID_WINDOW_MS / 1000),
                "NX",
            );
            if (acquired !== "OK") return result;
            result.incidentAcquired = true;
        } catch (error) {
            this.logError("infinite-void-incident-lock", error, { guildId: guild.id, executorId, count });
            return result;
        }

        // Bypass stores are independent. Revocation failures are logged, but an
        // emergency punishment must not be skipped after the threshold lock is won.
        await this.revokeInfiniteVoidBypasses(guild.id, executorId, config);

        const preflight = await this.refreshConfig(guild.id, "infinite-void-preflight-refresh");
        const stillEnabled = preflight?.enabled && preflight.member.some(entry => entry.type === "infiniteVoid" && entry.enabled);
        if (!stillEnabled || executorId === guild.ownerId || executorId === this.client.user?.id) return result;

        const punishment = await this.punishInfiniteVoidExecutor(guild, executorId);
        result.punished = punishment.punished;
        result.action = punishment.action;
        await this.logInfiniteVoidIncident(guild, executorId, targetId, auditEntryId, count, punishment);
        return result;
    }

    private async revokeInfiniteVoidBypasses(guildId: string, executorId: string, config: AntiNuke): Promise<void> {
        try {
            await this.client.redis.eval(
                REVOKE_EXTRA_OWNER_SCRIPT,
                1,
                `extraowners:${guildId}`,
                executorId,
            );
        } catch (error) {
            this.logError("infinite-void-extra-owner-revocation", error, { guildId, executorId });
        }

        try {
            const updated = await AntiNuke.update(guildId, {
                trustedUsers: removeTrustedUser(config.trustedUsers, executorId),
                admin: config.admin === executorId ? null : config.admin,
            });
            await this.invalidateGuild(guildId, updated);
            await this.clearWhitelistState(guildId, executorId);
        } catch (error) {
            this.logError("infinite-void-database-bypass-revocation", error, { guildId, executorId });
        }
    }

    private async punishInfiniteVoidExecutor(
        guild: Guild,
        executorId: string,
    ): Promise<{ punished: boolean; action: "ban" | "rolestrip-timeout" | "rolestrip" | "timeout" | "none" }> {
        const reason = `Infinite Void | ${INFINITE_VOID_THRESHOLD} confirmed member kicks in 20 minutes`;
        let member = guild.members.cache.get(executorId);
        if (!member) {
            member = await guild.members.fetch(executorId).catch(error => {
                this.logError("infinite-void-member-fetch", error, { guildId: guild.id, executorId });
                return null;
            }) ?? undefined;
        }
        if (!member) return { punished: false, action: "none" };

        if (member.bannable) {
            try {
                await guild.members.ban(executorId, { deleteMessageSeconds: 0, reason });
                return { punished: true, action: "ban" };
            } catch (error) {
                this.logError("infinite-void-ban", error, { guildId: guild.id, executorId });
            }
        }

        let rolesStripped = false;
        let timedOut = false;
        const manageableRoles = [...member.roles.cache.values()].filter(role =>
            role.id !== guild.id && !role.managed && role.editable,
        );
        if (manageableRoles.length) {
            try {
                await member.roles.remove(manageableRoles, reason);
                rolesStripped = true;
            } catch (error) {
                this.logError("infinite-void-role-strip", error, { guildId: guild.id, executorId, roleCount: manageableRoles.length });
            }
        }
        if (member.moderatable) {
            try {
                await member.timeout(INFINITE_VOID_TIMEOUT_MS, reason);
                timedOut = true;
            } catch (error) {
                this.logError("infinite-void-timeout", error, { guildId: guild.id, executorId });
            }
        }

        const action = rolesStripped && timedOut
            ? "rolestrip-timeout"
            : rolesStripped
                ? "rolestrip"
                : timedOut
                    ? "timeout"
                    : "none";
        return { punished: rolesStripped || timedOut, action };
    }

    private async logInfiniteVoidIncident(
        guild: Guild,
        executorId: string,
        targetId: string,
        auditEntryId: string,
        count: number,
        punishment: { punished: boolean; action: string },
    ): Promise<void> {
        const incident = {
            event: "infinite_void_incident",
            guildId: guild.id,
            executorId,
            targetId,
            auditEntryId,
            count,
            punishment: punishment.action,
            punished: punishment.punished,
        };
        this.client.logger.info(`[AntiNuke] ${JSON.stringify(incident)}`);

        if (!guild.channels?.fetch) return;
        try {
            const logger = await AuditLogger.get(guild.id);
            const channelId = logger?.enabled
                ? logger.channelAndType.find(entry => entry.type === "member_kick")?.channelId
                : undefined;
            if (!channelId) return;
            const channel = await guild.channels.fetch(channelId);
            if (!channel?.isSendable()) return;
            await channel.send({
                content: `⚠️ **Infinite Void incident**\nExecutor: \`${executorId}\`\nConfirmed kicks: **${count} / ${INFINITE_VOID_THRESHOLD}**\nAction: **${punishment.action}**${punishment.punished ? "" : " (not completed)"}`,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            this.logError("infinite-void-incident-log", error, incident);
        }
    }

    async punishUser(guild: Guild, userId: string, action: string, reason: string): Promise<boolean> {
        const config = await this.refreshConfig(guild.id, "punishment-config-refresh");
        if (!config || isAntiNukeBypassed(config, guild.ownerId, this.client.user?.id, userId)) return false;

        const lockKey = `antinuke:punishment:${guild.id}:${userId}`;
        if (this.locks.has(lockKey)) return false;

        try {
            const acquired = await this.client.redis.set(lockKey, "1", "EX", this.lockTtl, "NX");
            if (acquired !== "OK") return false;
        } catch (error) {
            this.logError("punishment-lock", error, { guildId: guild.id, userId, action, fallback: "local" });
            // Redis is unavailable: JS execution makes this check-and-add atomic within this process.
            if (this.locks.has(lockKey)) return false;
        }

        this.locks.add(lockKey);
        setTimeout(() => this.locks.delete(lockKey), this.lockTtl * 1000).unref();

        // Disable/whitelist changes may race the network lock request; verify again
        // immediately before executing any Discord side effect.
        const preflight = await this.refreshConfig(guild.id, "punishment-preflight-refresh");
        if (!preflight || isAntiNukeBypassed(preflight, guild.ownerId, this.client.user?.id, userId)) return false;

        const truncatedReason = reason.slice(0, 500);
        let punished = false;

        try {
            switch (action) {
                case "ban":
                    await guild.members.ban(userId, { deleteMessageSeconds: 0, reason: truncatedReason });
                    punished = true;
                    break;
                case "kick":
                    await guild.members.kick(userId, truncatedReason);
                    punished = true;
                    break;
                case "rolestrip":
                case "role-remove": {
                    let member = guild.members.cache.get(userId);
                    if (!member) {
                        try {
                            member = await guild.members.fetch(userId);
                        } catch (error) {
                            this.logError("punishment-member-fetch", error, { guildId: guild.id, userId, action });
                        }
                    }
                    if (!member) break;
                    const roles = [...member.roles.cache.values()].filter(role => !role.managed && role.id !== guild.id);
                    if (roles.length) await member.roles.remove(roles, truncatedReason);
                    punished = true;
                    break;
                }
                default:
                    this.client.logger.error(`[AntiNuke] unsupported-punishment ${JSON.stringify({ guildId: guild.id, userId, action })}`);
            }
        } catch (error) {
            this.logError("punishment", error, { guildId: guild.id, userId, action });
        } finally {
            this.clearUserActions(guild.id, userId);
        }
        return punished;
    }
    canModerate(target: GuildMember, mod: GuildMember): boolean {
        const guild = target.guild;
        return mod.id === guild.ownerId ||
            (target.id !== guild.ownerId && target.id !== mod.id && target.roles.highest.position < mod.roles.highest.position);
    }
}
