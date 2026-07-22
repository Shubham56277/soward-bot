import type { Redis } from "ioredis";

export interface CooldownResult {
	allowed: boolean;
	retryAfterMs: number;
}

/**
 * Command cooldown service with Redis-backed and in-memory fallback.
 * Uses SET NX (atomic) to prevent race conditions.
 */
export class CommandCooldownService {
	/** In-memory fallback when Redis is unavailable */
	private readonly memoryStore = new Map<string, number>();

	public constructor(private readonly redis: Redis) {}

	/**
	 * Try to consume a cooldown slot.
	 * @param commandKey - Command identifier (e.g., "ban" or "music play")
	 * @param userId - Discord user ID
	 * @param durationSeconds - Cooldown duration in seconds (0 = no cooldown)
	 * @returns Whether the action is allowed and how long to wait
	 */
	public async take(commandKey: string, userId: string, durationSeconds: number): Promise<CooldownResult> {
		const durationMs = Math.max(0, Math.round(durationSeconds * 1_000));
		if (durationMs === 0) return { allowed: true, retryAfterMs: 0 };

		// Try Redis first
		if (this.redis?.status === "ready") {
			try {
				const key = `cooldown:command:${commandKey}:${userId}`;
				const acquired = await this.redis.set(key, "1", "PX", durationMs, "NX");
				if (acquired === "OK") return { allowed: true, retryAfterMs: 0 };
				const ttl = await this.redis.pttl(key);
				return { allowed: false, retryAfterMs: Math.max(1, ttl) };
			} catch {
				// Redis failed — fall through to in-memory
			}
		}

		// In-memory fallback
		const memoryKey = `${commandKey}:${userId}`;
		const now = Date.now();
		const expiry = this.memoryStore.get(memoryKey) ?? 0;

		if (now < expiry) {
			return { allowed: false, retryAfterMs: expiry - now };
		}

		this.memoryStore.set(memoryKey, now + durationMs);
		// Cleanup after duration
		setTimeout(() => this.memoryStore.delete(memoryKey), durationMs).unref();
		return { allowed: true, retryAfterMs: 0 };
	}

	/**
	 * Clear a cooldown early (useful for testing or manual override).
	 */
	public async clear(commandKey: string, userId: string): Promise<void> {
		const memoryKey = `${commandKey}:${userId}`;
		this.memoryStore.delete(memoryKey);

		if (this.redis?.status === "ready") {
			try {
				const key = `cooldown:command:${commandKey}:${userId}`;
				await this.redis.del(key);
			} catch {
				// Ignore Redis errors during clear
			}
		}
	}
}
