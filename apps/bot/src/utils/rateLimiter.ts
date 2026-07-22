import Redis from "ioredis";

interface RateLimitOptions {
    windowMs: number; 
    max: number; 
    keyPrefix: string;
}

export class RateLimiter {
    constructor(private redis: Redis) {}
    public async checkRateLimit(
        key: string,
        options: RateLimitOptions,
    ): Promise<{ limited: boolean; remaining: number; resetTime: number }> {
        const redisKey = `${options.keyPrefix}:${key}`;
        const now = Date.now();
        const windowStart = now - options.windowMs;

        const result = await this.redis
            .pipeline()
            .zremrangebyscore(redisKey, 0, windowStart) 
            .zcard(redisKey) 
            .zadd(redisKey, now, now.toString()) 
            .expire(redisKey, Math.ceil(options.windowMs / 1000)) 
            .exec();

        if (!result) {
            throw new Error("Redis pipeline failed");
        }

        const count = result?.[1]?.[1] as number;
        const remaining = Math.max(0, options.max - count);

        return {
            limited: count >= options.max,
            remaining,
            resetTime: windowStart + options.windowMs,
        };
    }
}
