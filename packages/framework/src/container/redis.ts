import { container } from "tsyringe";
import { kRedis } from "./tokens.js";
import { env } from "@repo/env";
import { Redis } from "ioredis";
import { configureCache } from "@repo/db";

export async function createRedis() {
    if (!env.REDIS_URL) throw new Error("REDIS_URL is required to start the bot");

    const redis = new Redis(env.REDIS_URL, {
        connectTimeout: 10_000,
        enableReadyCheck: true,
        maxRetriesPerRequest: null,
    });
    redis.on("error", () => {
        // Individual consumers handle failures; this listener prevents unhandled errors.
    });
    await redis.ping();

    container.register(kRedis, { useValue: redis });
    configureCache(redis);
    return redis;
}
