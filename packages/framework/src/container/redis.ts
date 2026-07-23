import { container } from "tsyringe";
import { kRedis } from "./tokens.js";
import { env } from "@repo/env";
import { Redis } from "ioredis";
import { configureCache } from "@repo/db";

export async function createRedis() {
    if (!env.REDIS_URL) throw new Error("REDIS_URL is required to start the bot");

    const redactedUrl = (() => {
        try {
            const parsed = new URL(env.REDIS_URL!);
            return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
        } catch {
            return "[invalid redis url]";
        }
    })();

    console.log(`[startup][redis] creating client for ${redactedUrl}`);
    const redis = new Redis(env.REDIS_URL, {
        connectTimeout: 10_000,
        enableReadyCheck: true,
        maxRetriesPerRequest: null,
    });
    redis.on("error", () => {
        // Individual consumers handle failures; this listener prevents unhandled errors.
    });
    const pingTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Redis ping timed out after 10000ms for ${redactedUrl}`)), 10_000);
    });
    console.log("[startup][redis] waiting for ping");
    await Promise.race([redis.ping(), pingTimeout]);
    console.log("[startup][redis] ping ok");

    container.register(kRedis, { useValue: redis });
    configureCache(redis);
    console.log("[startup][redis] container registered and cache configured");
    return redis;
}
