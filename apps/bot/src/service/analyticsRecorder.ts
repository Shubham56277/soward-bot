import type { Redis } from "ioredis";

export interface AnalyticsEvent {
	timestamp: number;
	guildId: string;
	userId: string;
	queryCategory: string;
	responseLatencyMs: number;
	provider: string;
	cacheHit: boolean;
	documentsRetrieved: number;
	toolCallsUsed: number;
	escalationRounds: number;
}

const TTL_48H = 48 * 60 * 60;
const MAX_LATENCY_SAMPLES = 1000;

export class AnalyticsRecorder {
	public constructor(private readonly redis: Redis) {}

	/** Record a query analytics event */
	public async record(event: AnalyticsEvent): Promise<void> {
		const day = this.dateKey();

		const queryKey = `ai:analytics:queries:${day}`;
		const latencyKey = `ai:analytics:latency:${day}`;

		// Increment daily query counter with 48h TTL
		this.redis
			.multi()
			.incr(queryKey)
			.expire(queryKey, TTL_48H)
			.exec()
			.catch(() => undefined);

		// Push latency sample and trim to max 1000
		this.redis
			.multi()
			.lpush(latencyKey, String(event.responseLatencyMs))
			.ltrim(latencyKey, 0, MAX_LATENCY_SAMPLES - 1)
			.expire(latencyKey, TTL_48H)
			.exec()
			.catch(() => undefined);

		// Increment command in sorted set if category starts with "cmd:"
		if (event.queryCategory.startsWith("cmd:")) {
			this.redis
				.zincrby("ai:analytics:top-commands", 1, event.queryCategory)
				.catch(() => undefined);
		}

		// Increment topic in sorted set
		this.redis
			.zincrby("ai:analytics:top-topics", 1, event.queryCategory)
			.catch(() => undefined);
	}

	/** Increment daily error counter */
	public async recordError(): Promise<void> {
		const day = this.dateKey();
		const errorKey = `ai:analytics:errors:${day}`;

		this.redis
			.multi()
			.incr(errorKey)
			.expire(errorKey, TTL_48H)
			.exec()
			.catch(() => undefined);
	}

	/** Get top queried commands in the last N hours */
	public async getTopCommands(
		_hours: number,
		limit: number,
	): Promise<Array<{ command: string; count: number }>> {
		try {
			const results = await this.redis.zrevrange(
				"ai:analytics:top-commands",
				0,
				limit - 1,
				"WITHSCORES",
			);

			const commands: Array<{ command: string; count: number }> = [];
			for (let i = 0; i < results.length; i += 2) {
				commands.push({
					command: results[i]!,
					count: Number(results[i + 1]) || 0,
				});
			}
			return commands;
		} catch {
			return [];
		}
	}

	/** Get aggregate metrics for today */
	public async getMetrics(): Promise<{
		totalQueries: number;
		errorRate: number;
		avgLatencyMs: number;
	}> {
		try {
			const day = this.dateKey();

			const [queries, errors, latencySamples] = await Promise.all([
				this.redis.get(`ai:analytics:queries:${day}`),
				this.redis.get(`ai:analytics:errors:${day}`),
				this.redis.lrange(`ai:analytics:latency:${day}`, 0, -1),
			]);

			const totalQueries = Number(queries) || 0;
			const totalErrors = Number(errors) || 0;
			const errorRate = totalQueries > 0 ? totalErrors / totalQueries : 0;

			let avgLatencyMs = 0;
			if (latencySamples.length > 0) {
				const sum = latencySamples.reduce(
					(acc, val) => acc + (Number(val) || 0),
					0,
				);
				avgLatencyMs = Math.round(sum / latencySamples.length);
			}

			return { totalQueries, errorRate, avgLatencyMs };
		} catch {
			return { totalQueries: 0, errorRate: 0, avgLatencyMs: 0 };
		}
	}

	/** Get today's date in YYYY-MM-DD format */
	private dateKey(): string {
		const now = new Date();
		const year = now.getUTCFullYear();
		const month = String(now.getUTCMonth() + 1).padStart(2, "0");
		const day = String(now.getUTCDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
}
