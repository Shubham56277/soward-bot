import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({
	path: path.join(__dirname, "../../../.env"),
});

const LavalinkNodeSchema = z.object({
	id: z.string(),
	host: z.string(),
	port: z.number(),
	authorization: z.string(),
	secure: z.preprocess((val) => (val === "true" || val === "false" ? val === "true" : val), z.boolean().optional()),
	sessionId: z.string().optional(),
	regions: z.string().array().optional(),
	retryAmount: z.number().optional(),
	retryDelay: z.number().optional(),
	retryTimespan: z.number().optional(),
	requestSignalTimeoutMS: z.number().optional(),
	closeOnError: z.boolean().optional(),
	heartBeatInterval: z.number().optional(),
	enablePingOnStatsCheck: z.boolean().optional(),
});

const optionalSecret = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z.string().optional(),
);

const optionalUrl = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z.url().optional(),
);

const integerFromEnv = (fallback: number, min: number, max: number) =>
	z.preprocess(
		(value) => (value === undefined || value === "" ? fallback : Number(value)),
		z.number().int().min(min).max(max),
	);

const booleanFromEnv = (fallback: boolean) =>
	z.preprocess((value) => {
		if (value === undefined || value === "") return fallback;
		if (typeof value === "string") return value.toLowerCase() === "true";
		return value;
	}, z.boolean());

const envSchema = z.object({
	DISCORD_APP_TOKEN: z.string(),

	DISCORD_APP_CLIENT_ID: z.string(),

	DISCORD_APP_CLIENT_SECRET: z.string().optional(),

	SENTRY_DSN: z.string().optional(),
	COMMAND_LOG_WEBHOOK_URL: optionalUrl,
	GUILD_CREATE_WEBHOOK_URL: optionalUrl,
	GUILD_DELETE_WEBHOOK_URL: optionalUrl,
	NO_PREFIX_WEBHOOK_URL: optionalUrl,
	PREMIUM_WEBHOOK_URL: optionalUrl,
	SHARD_WEBHOOK_URL: optionalUrl,
	/** Receives alerts for high-severity/critical errors (rate-limited). Falls back to no alerting if unset. */
	// Changed from optionalUrl to optionalSecret to allow non-URL strings without validation errors.
	ERROR_WEBHOOK_URL: optionalSecret,
	/** Channel ID in your developer server where song requests are forwarded */
	SONG_REQUEST_CHANNEL_ID: z.string().optional(),

	GUILD_ID: z.string().optional(),
	
	DEVELOPER_IDS: z.preprocess((val) => (typeof val === "string" ? JSON.parse(val) : val), z.string().array()),

	PREFIX: z.string().default("!"),

	DATABASE_URI: z.string().optional(),

	REDIS_URL: z.string().optional(),

	NODE_ENV: z.literal("development").or(z.literal("production")).optional(),

	NODES: z.preprocess((val) => (typeof val === "string" ? JSON.parse(val) : val), z.array(LavalinkNodeSchema)),

	OXAPAY_MERCHANT_KEY: z.string().optional(),

	NEXT_PUBLIC_BASE_URL: z.string().optional(),

	IMAGIFY_API_URL: z.string().optional(),

	MEDIA_PROXY_URL: optionalUrl,

	GROQ_API_KEY: optionalSecret,
	GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
	GEMINI_API_KEY: optionalSecret,
	GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),
	OPENROUTER_API_KEY: optionalSecret,
	OPENROUTER_MODEL: z.string().default("openrouter/free"),
	HUGGINGFACE_TOKEN: optionalSecret,
	HUGGINGFACE_MODEL: z.string().default("Qwen/Qwen2.5-7B-Instruct"),

	// Multi-key arrays for AI Cluster Manager (supports strings or {key,model} objects)
	GROQ_API_KEYS: z.preprocess((val) => {
		if (!val || (typeof val === "string" && val.trim() === "")) return undefined;
		if (typeof val === "string") { try { return JSON.parse(val); } catch { return [val]; } }
		return val;
	}, z.array(z.union([z.string(), z.object({ key: z.string(), model: z.string().optional() })])).optional()),
	GEMINI_API_KEYS: z.preprocess((val) => {
		if (!val || (typeof val === "string" && val.trim() === "")) return undefined;
		if (typeof val === "string") { try { return JSON.parse(val); } catch { return [val]; } }
		return val;
	}, z.array(z.union([z.string(), z.object({ key: z.string(), model: z.string().optional() })])).optional()),
	OPENROUTER_API_KEYS: z.preprocess((val) => {
		if (!val || (typeof val === "string" && val.trim() === "")) return undefined;
		if (typeof val === "string") { try { return JSON.parse(val); } catch { return [val]; } }
		return val;
	}, z.array(z.union([z.string(), z.object({ key: z.string(), model: z.string().optional() })])).optional()),
	HUGGINGFACE_TOKENS: z.preprocess((val) => {
		if (!val || (typeof val === "string" && val.trim() === "")) return undefined;
		if (typeof val === "string") { try { return JSON.parse(val); } catch { return [val]; } }
		return val;
	}, z.array(z.union([z.string(), z.object({ key: z.string(), model: z.string().optional() })])).optional()),
	AI_TIMEOUT_SECONDS: integerFromEnv(12, 2, 30),
	AI_MAX_HISTORY: integerFromEnv(6, 0, 30),
	AI_MAX_OUTPUT_TOKENS: integerFromEnv(500, 64, 2_000),
	AI_RACE_MODE: booleanFromEnv(true),
	AI_SESSION_TTL_SECONDS: integerFromEnv(21_600, 300, 86_400),
	AI_USER_REQUESTS_PER_MINUTE: integerFromEnv(10, 1, 60),
	AI_GUILD_REQUESTS_PER_MINUTE: integerFromEnv(100, 1, 1_000),
	AI_MAX_CONCURRENCY: integerFromEnv(50, 1, 200),
	AI_RESPONSE_CACHE_SECONDS: integerFromEnv(300, 0, 3_600),
});

type Env = z.infer<typeof envSchema>;

/**
 * The environment variables
 */
export const env: Env = envSchema.parse(process.env);

for (const key in env) {
	if (!(key in env)) {
		throw new Error(`Missing env variable: ${key}`);
	}
}
