import type { Guild } from "discord.js";
import type { Redis } from "ioredis";
import { Premium } from "@repo/db";

const GUILD_PREMIUM_KEY = (guildId: string) => `guild:premium:${guildId}`;
const CACHE_TTL_HIT = 600; // 10 min when the guild HAS premium
const CACHE_TTL_MISS = 120; // 2 min when it does not (so new redeems apply quickly)

/**
 * Server-wide premium check.
 *
 * A guild is premium if ANY of its members has an active premium subscription.
 * Once satisfied, every member of that guild can use premium commands.
 *
 * Resolution order:
 *  1. The requesting user's own premium (fast path, no guild scan).
 *  2. Redis cache for the guild verdict.
 *  3. Single DB query across the guild's known member IDs.
 */
export async function checkPremium(redis: Redis, userId: string, guild: Guild): Promise<boolean> {
	// 1. Fast path — the caller has their own premium.
	if (await Premium.hasPremium(userId).catch(() => false)) {
		redis.set(GUILD_PREMIUM_KEY(guild.id), "1", "EX", CACHE_TTL_HIT).catch(() => {});
		return true;
	}

	// 2. Cached guild verdict.
	try {
		const cached = await redis.get(GUILD_PREMIUM_KEY(guild.id));
		if (cached === "1") return true;
		if (cached === "0") return false;
	} catch {
		// Redis unavailable — fall through to a live lookup.
	}

	// 3. Live lookup against the guild's members.
	const memberIds = await collectMemberIds(guild);
	let hasPremium = false;
	try {
		hasPremium = await Premium.anyHasPremium(memberIds);
	} catch {
		// DB error — deny rather than granting premium by accident.
		return false;
	}

	redis
		.set(GUILD_PREMIUM_KEY(guild.id), hasPremium ? "1" : "0", "EX", hasPremium ? CACHE_TTL_HIT : CACHE_TTL_MISS)
		.catch(() => {});

	return hasPremium;
}

/** Invalidate a guild's cached premium verdict (call right after a successful redeem). */
export async function invalidateGuildPremium(redis: Redis, guildId: string): Promise<void> {
	await redis.del(GUILD_PREMIUM_KEY(guildId)).catch(() => {});
}

/**
 * Gather candidate member IDs for the premium lookup.
 * Uses the cache when it looks complete, otherwise fetches the member list once.
 */
async function collectMemberIds(guild: Guild): Promise<string[]> {
	const ids = new Set<string>([guild.ownerId]);

	const cacheLooksComplete = guild.memberCount > 0 && guild.members.cache.size >= guild.memberCount;
	if (!cacheLooksComplete) {
		await guild.members.fetch().catch(() => undefined);
	}

	for (const [id, member] of guild.members.cache) {
		if (!member.user.bot) ids.add(id);
	}

	return [...ids];
}
