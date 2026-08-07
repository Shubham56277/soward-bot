import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

function findEnvironmentFile(startDirectory: string): string | undefined {
	let directory = path.resolve(startDirectory);
	while (true) {
		const candidate = path.join(directory, ".env");
		if (existsSync(candidate)) return candidate;
		const parent = path.dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

const configuredPath = process.env.DOTENV_CONFIG_PATH?.trim();
const environmentPath = configuredPath || findEnvironmentFile(process.cwd()) || (process.argv[1] ? findEnvironmentFile(path.dirname(process.argv[1])) : undefined);
config({ ...(environmentPath ? { path: environmentPath } : {}), quiet: true });

/** Environment keys whose values must be valid JSON. Values are never included in errors. */
export const JSON_ENVIRONMENT_KEYS = ["DEVELOPER_IDS", "NODES", "GROQ_API_KEYS", "GEMINI_API_KEYS", "OPENROUTER_API_KEYS", "HUGGINGFACE_TOKENS"] as const;

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
		if (value === undefined) continue;
		if (value.trim() === "") {
			parsed[key] = undefined;
			continue;
		}
		try {
			parsed[key] = JSON.parse(value);
		} catch {
			// JSON parser messages can contain excerpts of the input, so never expose them here.
			errors.push(`${key} must contain valid JSON.`);
		}
	}

	if (errors.length > 0) throw new EnvironmentValidationError(errors);
	return parsed;
}

const nonEmptyString = z.string().trim().min(1);
const snowflake = z
	.string()
	.trim()
	.regex(/^\d{17,20}$/, "must be a valid Discord snowflake");
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

const LavalinkNodeSchema = z.object({
	id: nonEmptyString,
	host: nonEmptyString,
	port: z.number().int().min(1).max(65_535),
	authorization: nonEmptyString,
	secure: z.preprocess((value) => (value === "true" || value === "false" ? value === "true" : value), z.boolean().optional()),
	sessionId: nonEmptyString.optional(),
	regions: nonEmptyString.array().optional(),
	retryAmount: nonNegativeInteger.optional(),
	retryDelay: nonNegativeInteger.optional(),
	retryTimespan: nonNegativeInteger.optional(),
	requestSignalTimeoutMS: positiveInteger.optional(),
	closeOnError: z.boolean().optional(),
	heartBeatInterval: positiveInteger.optional(),
	enablePingOnStatsCheck: z.boolean().optional(),
});

const optionalSecret = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), nonEmptyString.optional());
const optionalSigningSecret = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), nonEmptyString.min(32).optional());
const optionalHttpUrl = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z
		.url()
		.refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "must use the http:// or https:// protocol")
		.optional(),
);
const optionalHttpsUrl = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z
		.url()
		.refine((value) => new URL(value).protocol === "https:", "must use the https:// protocol")
		.optional(),
);
const optionalSnowflake = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), snowflake.optional());
const optionalRedisUrl = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z
		.url()
		.refine((value) => /^rediss?:\/\//i.test(value), "must use the redis:// or rediss:// protocol")
		.optional(),
);
const integerFromEnv = (fallback: number, min: number, max: number) =>
	z.preprocess((value) => {
		if (value === undefined) return fallback;
		if (typeof value !== "string") return value;
		const normalized = value.trim();
		if (normalized === "") return fallback;
		return /^-?\d+$/.test(normalized) ? Number(normalized) : value;
	}, z.number().int().min(min).max(max));
const booleanFromEnv = (fallback: boolean) =>
	z.preprocess((value) => {
		if (value === undefined) return fallback;
		if (typeof value !== "string") return value;
		const normalized = value.trim().toLowerCase();
		if (normalized === "") return fallback;
		if (normalized === "true") return true;
		if (normalized === "false") return false;
		return value;
	}, z.boolean());
const multiKeySchema = z.array(z.union([nonEmptyString, z.object({ key: nonEmptyString, model: nonEmptyString.optional() })])).optional();

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.startsWith("127.") || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}

function isLoopbackUrl(value: string): boolean {
	return isLoopbackHostname(new URL(value).hostname);
}

const envSchema = z
	.object({
		DISCORD_APP_TOKEN: nonEmptyString,
		DISCORD_APP_CLIENT_ID: snowflake,
		DISCORD_APP_CLIENT_SECRET: optionalSecret,
		SENTRY_DSN: optionalSecret,
		COMMAND_LOG_WEBHOOK_URL: optionalHttpsUrl,
		GUILD_CREATE_WEBHOOK_URL: optionalHttpsUrl,
		GUILD_DELETE_WEBHOOK_URL: optionalHttpsUrl,
		NO_PREFIX_WEBHOOK_URL: optionalHttpsUrl,
		PREMIUM_WEBHOOK_URL: optionalHttpsUrl,
		SHARD_WEBHOOK_URL: optionalHttpsUrl,
		ERROR_WEBHOOK_URL: optionalHttpsUrl,
		SONG_REQUEST_CHANNEL_ID: optionalSnowflake,
		GUILD_ID: optionalSnowflake,
		DEVELOPER_IDS: snowflake.array(),
		PREFIX: z.string().default("!"),
		DATABASE_URI: optionalSecret,
		REDIS_URL: optionalRedisUrl,
		API_SIGNING_SECRET: optionalSigningSecret,
		API_PORT: integerFromEnv(5_173, 1, 65_535),
		NODE_ENV: z.enum(["development", "production"]).optional(),
		NODES: z.array(LavalinkNodeSchema),
		OXAPAY_MERCHANT_KEY: optionalSecret,
		NEXT_PUBLIC_BASE_URL: optionalHttpUrl,
		IMAGIFY_API_URL: optionalHttpUrl,
		MEDIA_PROXY_URL: optionalHttpUrl,
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
		AI_MAX_OUTPUT_TOKENS: integerFromEnv(200, 64, 2_000),
		AI_RACE_MODE: booleanFromEnv(true),
		AI_SESSION_TTL_SECONDS: integerFromEnv(21_600, 300, 86_400),
		AI_USER_REQUESTS_PER_MINUTE: integerFromEnv(10, 1, 60),
		AI_GUILD_REQUESTS_PER_MINUTE: integerFromEnv(100, 1, 1_000),
		AI_MAX_CONCURRENCY: integerFromEnv(10, 1, 200),
		AI_RESPONSE_CACHE_SECONDS: integerFromEnv(300, 0, 3_600),
	})
	.superRefine((environment, context) => {
		if (environment.NODE_ENV !== "production") return;

		const secureTransports = [
			{ key: "REDIS_URL", value: environment.REDIS_URL, protocol: "rediss:", description: "rediss://" },
			{ key: "NEXT_PUBLIC_BASE_URL", value: environment.NEXT_PUBLIC_BASE_URL, protocol: "https:", description: "https://" },
			{ key: "IMAGIFY_API_URL", value: environment.IMAGIFY_API_URL, protocol: "https:", description: "https://" },
			{ key: "MEDIA_PROXY_URL", value: environment.MEDIA_PROXY_URL, protocol: "https:", description: "https://" },
		] as const;

		for (const transport of secureTransports) {
			if (!transport.value || isLoopbackUrl(transport.value) || new URL(transport.value).protocol === transport.protocol) continue;
			context.addIssue({
				code: "custom",
				path: [transport.key],
				message: `must use ${transport.description} for non-loopback hosts in production`,
			});
		}
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
