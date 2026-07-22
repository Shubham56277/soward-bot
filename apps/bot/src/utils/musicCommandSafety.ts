import type { Redis } from "ioredis";

const MUSIC_LOCK_TTL_MS = 30_000;
const RELEASE_LOCK_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseMusicCommandLock = () => Promise<void>;

/**
 * Serializes queue/player mutations for a guild. Discord can deliver commands from
 * multiple users at the same time, while Lavalink's player and queue are mutable.
 */
export async function acquireMusicCommandLock(redis: Redis, guildId: string, requestId: string): Promise<ReleaseMusicCommandLock | null> {
	const key = `music:command:${guildId}`;
	const token = `${requestId}:${Date.now()}`;
	const acquired = await redis.set(key, token, "PX", MUSIC_LOCK_TTL_MS, "NX");
	if (!acquired) return null;

	let released = false;
	return async () => {
		if (released) return;
		released = true;
		await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token).catch(() => undefined);
	};
}

