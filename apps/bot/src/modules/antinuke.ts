import { AntiNuke, AntiNukeChannel, AntiNukeMember } from "@repo/db";
import BaseClient from "../base/Client";
import { Guild, GuildChannel, GuildMember, Routes } from "discord.js";

// Blazing fast cache keys
const getActionKey = (g: string, u: string, a: string) => `${g}:${u}:${a}`;
const getConfigKey = (g: string) => `c:${g}`;

export class AntiNukeService {
    private readonly actionExpiry = 45;
    private readonly lockTtl = 20;
    private readonly batchDelay = 8;

    // Ultra-aggressive memory caching
    private configs = new Map<string, AntiNuke>();
    private locks = new Set<string>();
    private actions = new Map<string, [number, number]>(); // [count, expires]


    constructor(private client: BaseClient) { }

    // Instant cache clearing
    clearUserActions(g: string, u: string): void {
        const prefix = `${g}:${u}:`;
        for (const key of this.actions.keys()) {
            if (key.startsWith(prefix)) this.actions.delete(key);
        }
		void this.deleteKeysByPrefix(prefix);
    }

    clearGuildConfig(g: string): void {
        this.configs.delete(g);
        process.nextTick(() => this.client.redis.del(getConfigKey(g)).catch(() => { }));
    }

    clearAllActions(g: string): void {
        const prefix = `${g}:`;
        for (const key of this.actions.keys()) {
            if (key.startsWith(prefix)) this.actions.delete(key);
        }
		void this.deleteKeysByPrefix(prefix);
    }

    async getConfig(g: string): Promise<AntiNuke> {
        // Instant memory lookup
        let config = this.configs.get(g);
        if (config) return config;

        const key = getConfigKey(g);

        // Single try-catch for speed
        try {
            const cached = await this.client.redis.get(key);
            if (cached) {
                config = new AntiNuke(g, JSON.parse(cached));
                this.configs.set(g, config);
                setTimeout(() => this.configs.delete(g), 180000); // 3min cache
                return config;
            }
        } catch { }

        // DB fallback
        config = await AntiNuke.get(g);
        this.configs.set(g, config);

        // Background cache
        process.nextTick(() => {
            this.client.redis.setex(key, 180, JSON.stringify(config)).catch(() => { });
        });

        setTimeout(() => this.configs.delete(g), 180000);
        return config;
    }

    async trackAction(guild: Guild, u: string, actionType: string, actionConfig: AntiNukeChannel | AntiNukeMember): Promise<boolean> {
        const key = getActionKey(guild.id, u, actionType);
        const now = Date.now();

        // Ultra-fast memory check
        const cached = this.actions.get(key);
        if (cached && cached[1] > now) {
            cached[0]++;
            if (cached[0] >= actionConfig.limit) {
                process.nextTick(() => this.punishUser(guild, u, actionConfig.action, actionType));
                return true;
            }

            // Background Redis update
            process.nextTick(() => {
                this.client.redis.multi().incr(key).expire(key, this.actionExpiry).exec().catch(() => { });
            });
            return false;
        }

        // Redis increment with immediate local cache
        try {
            const count = await this.client.redis.eval(
                'local c = redis.call("INCR", KEYS[1]); redis.call("EXPIRE", KEYS[1], ARGV[1]); return c',
                1, key, this.actionExpiry.toString()
            ) as number;

            this.actions.set(key, [count, now + this.actionExpiry * 1000]);
			this.pruneActions(now);

            if (count >= actionConfig.limit) {
                process.nextTick(() => this.punishUser(guild, u, actionConfig.action, actionType));
                return true;
            }
        } catch {
            // Local fallback
            const count = (cached?.[0] || 0) + 1;
            this.actions.set(key, [count, now + this.actionExpiry * 1000]);
            if (count >= actionConfig.limit) {
                process.nextTick(() => this.punishUser(guild, u, actionConfig.action, actionType));
                return true;
            }
        }

        return false;
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
			const [nextCursor, keys] = await this.client.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100).catch(() => ["0", []] as [string, string[]]);
			cursor = nextCursor;
			if (keys.length) await this.client.redis.unlink(...keys).catch(() => undefined);
		} while (cursor !== "0");
	}

    cleanupChannels(guild: Guild, u: string): void {
        process.nextTick(async () => {
            try {
                const logs = await guild.fetchAuditLogs({ type: 10, limit: 15 });
                const channels = logs.entries
                    .filter(e => e.executor?.id === u && e.target instanceof GuildChannel)
                    .map(e => e.target as GuildChannel);

                if (!channels.length) return;

                // Batched parallel deletion
                const promises = channels.map((ch, i) =>
                    new Promise<void>(resolve => setTimeout(async () => {
                        try {
                            await this.client.rest.delete(Routes.channel(ch.id));
                        } catch {
                            try {
                                await guild.channels.cache.get(ch.id)?.delete?.();
                            } catch { }
                        }
                        resolve();
                    }, i * this.batchDelay))
                );

                await Promise.allSettled(promises);
            } catch { }
        });
    }

    async punishUser(guild: Guild, userId: string, action: string, reason: string): Promise<void> {
        const lockKey = `lock:${guild.id}:${userId}`;

        // Ultra-fast memory lock check
        if (this.locks.has(lockKey)) return;
        this.locks.add(lockKey);

        // Fire-and-forget lock expiration
        setTimeout(() => this.locks.delete(lockKey), this.lockTtl * 1000);

        // Execute punishment without waiting for anything else
        const punishmentPromise = (async () => {
            const truncatedReason = reason.slice(0, 500);

            try {
                switch (action) {
                    case "ban":
                        await guild.members.ban(userId, {
                            deleteMessageSeconds: 0,
                            reason: truncatedReason
                        }).catch(() => { });
                        break;

                    case "kick":
                        await guild.members.kick(userId, truncatedReason).catch(() => { });
                        break;

                    case "role-remove": {
                        const member = guild.members.cache.get(userId);
                        if (member) {
                            const roles = [...member.roles.cache.values()]
                                .filter(r => !r.managed && r.id !== guild.id);
                            if (roles.length) {
                                await member.roles.remove(roles, truncatedReason).catch(() => { });
                            }
                        }
                        break;
                    }
                }
            } catch { }

            // Fire-and-forget cleanup
            this.clearUserActions(guild.id, userId);
            this.client.redis.setex(lockKey, this.lockTtl, "1").catch(() => { });
        })();

        // Don't wait for punishment to complete
        return punishmentPromise.catch(() => { });
    }
    canModerate(target: GuildMember, mod: GuildMember): boolean {
        const guild = target.guild;
        return mod.id === guild.ownerId ||
            (target.id !== guild.ownerId && target.id !== mod.id && target.roles.highest.position < mod.roles.highest.position);
    }
}
