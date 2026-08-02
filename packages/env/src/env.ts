import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: path.join(__dirname, "../../../.env") });

/** Environment keys whose values must be valid JSON. Values are never included in errors. */
export const JSON_ENVIRONMENT_KEYS = [
	"DEVELOPER_IDS",
	"NODES",
	"GROQ_API_KEYS",
	"GEMINI_API_KEYS",
	"OPENROUTER_API_KEYS",
	"HUGGINGFACE_TOKENS",
] as const;

type JsonEnvironmentKey = (typeof JSON_ENVIRONMENT_KEYS)[number];

export class EnvironmentValidationError extends Error {
	constructor(messages: string[]) {
		super(`Invalid environment configuration:\n${messages.map((message) => `- ${message}`).join("\n")}`);
		this.name = "EnvironmentValidationError";
	}
}

function parseJsonEnvironmentValues(source: NodeJS.ProcessEnv): Partial<Record<JsonEnvironmentKey, unknown>> {
	const parsed: Partial<Record<JsonEnvironmentKey, unknown>> = {};
	const errors: string[] = [];

	for (const key of JSON_ENVIRONMENT_KEYS) {
		const value = source[key];
		if (value === undefined || value.trim() === "") continue;
		try {
			parsed[key] = JSON.parse(value);
		} catch (error) {
			const reason = error instanceof Error ? error.message : "invalid JSON";
			errors.push(`${key} must contain valid JSON (${reason}).`);
		}
	}

	if (errors.length > 0) throw new EnvironmentValidationError(errors);
	return parsed;
}

const LavalinkNodeSchema = z.object({
	id: z.string(),
	host: z.string(),
	port: z.number(),
	authorization: z.string(),
	secure: z.preprocess((value) => (value === "true" || value === "false" ? value === "true" : value), z.boolean().optional()),
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
	z.preprocess((value) => (value === undefined || value === "" ? fallback : Number(value)), z.number().int().min(min).max(max));
const booleanFromEnv = (fallback: boolean) =>
	z.preprocess((value) => {
		if (value === undefined || value === "") return fallback;
		return typeof value === "string" ? value.toLowerCase() === "true" : value;
	}, z.boolean());
const multiKeySchema = z.array(z.union([z.string(), z.object({ key: z.string(), model: z.string().optional() })])).optional();

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
	ERROR_WEBHOOK_URL: optionalSecret,
	SONG_REQUEST_CHANNEL_ID: z.string().optional(),
	GUILD_ID: z.string().optional(),
	DEVELOPER_IDS: z.string().array(),
	PREFIX: z.string().default("!"),
	DATABASE_URI: z.string().optional(),
	REDIS_URL: z.string().optional(),
	NODE_ENV: z.literal("development").or(z.literal("production")).optional(),
	NODES: z.array(LavalinkNodeSchema),
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
	GROQ_API_KEYS: multiKeySchema,
	GEMINI_API_KEYS: multiKeySchema,
	OPENROUTER_API_KEYS: multiKeySchema,
	HUGGINGFACE_TOKENS: multiKeySchema,
	AI_TIMEOUT_SECONDS: integerFromEnv(12, 2, 30),
	AI_MAX_HISTORY: integerFromEnv(6, 0, 30),
	AI_MAX_OUTPUT_TOKENS: integerFromEnv(500, 64, 2_000),
	AI_RACE_MODE: booleanFromEnv(true),
	AI_SESSION_TTL_SECONDS: integerFromEnv(21_600, 300, 86_400),
	AI_USER_REQUESTS_PER_MINUTE: integerFromEnv(10, 1, 60),
	AI_GUILD_REQUESTS_PER_MINUTE: integerFromEnv(100, 1, 1_000),
	AI_MAX_CONCURRENCY: integerFromEnv(10, 1, 200),
	AI_RESPONSE_CACHE_SECONDS: integerFromEnv(300, 0, 3_600),
});

type Env = z.infer<typeof envSchema>;
const parsedEnvironment = envSchema.safeParse({ ...process.env, ...parseJsonEnvironmentValues(process.env) });

if (!parsedEnvironment.success) {
	const messages = parsedEnvironment.error.issues.map((issue) => {
		const key = issue.path.length > 0 ? issue.path.join(".") : "environment";
		return `${key}: ${issue.message}`;
	});
	throw new EnvironmentValidationError(messages);
}

/** The validated environment variables. */
export const env: Env = parsedEnvironment.data;
