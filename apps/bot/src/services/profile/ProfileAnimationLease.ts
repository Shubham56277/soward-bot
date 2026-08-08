import type { Redis } from "ioredis";

const SLOT_COUNT = 2;
const LEASE_TTL_MS = 35_000;
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseProfileAnimationLease = () => Promise<void>;

/** Acquires one deployment-wide animation slot without polling. Redis failures fail closed. */
export async function acquireProfileAnimationLease(redis: Pick<Redis, "set" | "eval">, requestToken: string): Promise<ReleaseProfileAnimationLease | null> {
	for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
		const key = `profile:animation:slot:${slot}`;
		const token = `${requestToken}:${slot}`;
		let acquired: unknown;
		try {
			acquired = await redis.set(key, token, "PX", LEASE_TTL_MS, "NX");
		} catch {
			return null;
		}
		if (!acquired) continue;
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			await Promise.resolve()
				.then(() => redis.eval(RELEASE_SCRIPT, 1, key, token))
				.catch(() => undefined);
		};
	}
	return null;
}
