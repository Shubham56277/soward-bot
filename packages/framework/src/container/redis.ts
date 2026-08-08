import { configureCache } from "@repo/db";
import { env } from "@repo/env";
import { Redis } from "ioredis";
import { container } from "tsyringe";
import { kRedis } from "./tokens.js";

const REDIS_OPERATION_TIMEOUT_MS = 10_000;
const REDIS_SHUTDOWN_TIMEOUT_MS = 2_000;

type ActiveRedis = {
	client: Redis;
	onError: (error: NodeJS.ErrnoException) => void;
};

let activeRedis: ActiveRedis | undefined;
let pendingRedis: Promise<Redis> | undefined;
let pendingClose: Promise<void> | undefined;
let redisProviderRegistered = false;

function registerRedisProvider(): void {
	if (redisProviderRegistered) return;
	container.register<Redis>(kRedis, {
		useFactory: () => {
			const redis = currentRedis();
			if (!redis) throw new Error("Redis has not been initialized");
			return redis;
		},
	});
	redisProviderRegistered = true;
}

function currentRedis(): Redis | undefined {
	const state = activeRedis;
	if (!state) return undefined;
	if (state.client.status !== "end") return state.client;

	activeRedis = undefined;
	configureCache(undefined);
	state.client.removeListener("error", state.onError);
	return undefined;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function initializeRedis(): Promise<Redis> {
	const redisUrl = env.REDIS_URL;
	if (!redisUrl) throw new Error("REDIS_URL is required to start the bot");

	const parsedUrl = new URL(redisUrl);
	const redactedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ""}`;
	console.log(`[startup][redis] creating client for ${redactedUrl}`);

	const redis = new Redis(redisUrl, {
		connectTimeout: REDIS_OPERATION_TIMEOUT_MS,
		enableReadyCheck: true,
		// BullMQ requires commands to retry indefinitely instead of failing after a fixed request count.
		maxRetriesPerRequest: null,
	});
	const onError = (error: NodeJS.ErrnoException) => {
		const code = error.code ? ` (${error.code})` : "";
		console.error(`[redis] client error${code}`);
	};
	redis.on("error", onError);

	try {
		console.log("[startup][redis] waiting for ping");
		await withTimeout(redis.ping(), REDIS_OPERATION_TIMEOUT_MS, `Redis ping timed out for ${redactedUrl}`);
	} catch (error) {
		redis.disconnect();
		redis.removeListener("error", onError);
		throw error;
	}

	console.log("[startup][redis] ping ok");
	activeRedis = { client: redis, onError };
	registerRedisProvider();
	configureCache(redis);
	console.log("[startup][redis] container registered and cache configured");
	return redis;
}

export function createRedis(): Promise<Redis> {
	if (pendingClose) return pendingClose.then(() => createRedis());

	const existing = currentRedis();
	if (existing) return Promise.resolve(existing);
	if (pendingRedis) return pendingRedis;

	pendingRedis = initializeRedis().finally(() => {
		pendingRedis = undefined;
	});
	return pendingRedis;
}

async function shutdownRedis(): Promise<void> {
	if (pendingRedis) await pendingRedis.catch(() => undefined);

	const state = activeRedis;
	activeRedis = undefined;
	configureCache(undefined);
	if (!state) return;

	const { client: redis, onError } = state;
	try {
		await withTimeout(redis.quit(), REDIS_SHUTDOWN_TIMEOUT_MS, "Redis shutdown timed out");
	} catch (error) {
		console.error("[redis] graceful shutdown failed; disconnecting", error instanceof Error ? error.message : error);
		redis.disconnect();
	} finally {
		if (redis.status !== "end") redis.disconnect();
		redis.removeListener("error", onError);
	}
}

export function closeRedis(): Promise<void> {
	if (pendingClose) return pendingClose;
	pendingClose = shutdownRedis().finally(() => {
		pendingClose = undefined;
	});
	return pendingClose;
}
