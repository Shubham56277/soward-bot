import { Guild, User } from "@repo/db";
import BaseClient from "../base/Client";

const MAX_ENTRIES = 10_000;
const prefixCache = new Map<string, CacheEntry<string>>();
const noPrefixCache = new Map<string, CacheEntry<boolean>>();

interface CacheEntry<T> {
	value: Promise<T>;
	expiresAt: number;
}

export function getCachedPrefix(client: BaseClient, guildId: string): Promise<string> {
	return readThrough(prefixCache, guildId, 15_000, async () => (await Guild.get(guildId))?.prefix || client.config.prefix);
}

export function getCachedNoPrefix(userId: string): Promise<boolean> {
	return readThrough(noPrefixCache, userId, 5_000, () => User.getNoPrefix(userId).then(Boolean));
}

function readThrough<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const cached = cache.get(key);
	if (cached && cached.expiresAt > now) return cached.value;
	if (cached) cache.delete(key);

	const value = loader().catch((error) => {
		cache.delete(key);
		throw error;
	});
	cache.set(key, { value, expiresAt: now + ttlMs });
	if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	return value;
}
