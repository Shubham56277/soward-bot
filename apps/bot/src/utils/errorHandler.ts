import {
	ButtonInteraction,
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	EmbedBuilder,
	Message,
	MessageComponentInteraction,
	MessageFlags,
	ModalSubmitInteraction,
	StringSelectMenuInteraction,
	WebhookClient,
} from "discord.js";
import { randomBytes } from "node:crypto";
import { env } from "@repo/env";
import type BaseClient from "../base/Client";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * GLOBAL ERROR BOUNDARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A single, centralized error-handling surface for the whole bot. Since this
 * bot runs across many servers concurrently, an unhandled error in one guild's
 * interaction must NEVER crash the process or leave a user staring at
 * "The application did not respond" — every failure path funnels through here.
 *
 * Responsibilities:
 *  1. Classify errors (network blip, permission issue, Discord API error, bug)
 *  2. Redact secrets before they ever touch a log line or webhook
 *  3. Always produce a user-safe reference ID so users can report reliably
 *  4. Rate-limit + deduplicate alerting so one recurring bug doesn't spam the
 *     ops webhook or blow through Discord's own rate limits
 *  5. Guarantee interactions are acknowledged (defer/reply) even on failure,
 *     since an un-acknowledged interaction is what produces the
 *     "didn't respond in time" error the user sees.
 */

// ─── Error reference IDs ──────────────────────────────────────────────────────

export function generateErrorReference(): string {
	return randomBytes(4).toString("hex").toUpperCase();
}

// ─── Secret redaction ─────────────────────────────────────────────────────────

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
	[/(?:mfa\.[\w-]{20,}|[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,27})/g, "[TOKEN_REDACTED]"],
	[/(?:postgres|postgresql):\/\/[^@\s]+@/gi, "postgres://[CREDENTIALS_REDACTED]@"],
	[/redis:\/\/[^@\s]+@/gi, "redis://[CREDENTIALS_REDACTED]@"],
	[/(api[-_]?key|authorization|secret|password)["']?\s*[=:]\s*["']?[\w-]{6,}/gi, "$1=[REDACTED]"],
	[/https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+/gi, "[WEBHOOK_URL_REDACTED]"],
];

export function redactSensitive(input: string): string {
	let result = input;
	for (const [pattern, replacement] of REDACTION_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

// ─── Error classification ─────────────────────────────────────────────────────

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export interface ClassifiedError {
	severity: ErrorSeverity;
	/** Short machine-readable category, used for dedup keys and metrics. */
	category: string;
	/** Whether this is expected to recur transiently (network blips, Discord outages). */
	transient: boolean;
	/** User-facing message. Kept generic; never leaks internals. */
	userMessage: string;
}

const DISCORD_API_TRANSIENT_CODES = new Set([
	"UND_ERR_CONNECT_TIMEOUT",
	"ECONNRESET",
	"ETIMEDOUT",
	"EAI_AGAIN",
]);

/**
 * Inspect an error and decide how severe it is and whether it's likely to be
 * a transient blip (network/Discord-side) versus a real bug in our code.
 */
export function classifyError(error: unknown): ClassifiedError {
	const err = error as any;
	const name: string = err?.name ?? "";
	const message: string = err?.message ?? String(error);
	const code = err?.code ?? err?.status;

	// Discord API outage / gateway hiccup — transient, low severity, don't page anyone.
	if (
		name === "DiscordAPIError" ||
		name === "HTTPError" ||
		DISCORD_API_TRANSIENT_CODES.has(code) ||
		/getaddrinfo|fetch failed|network|socket hang up/i.test(message)
	) {
		return {
			severity: "low",
			category: "network",
			transient: true,
			userMessage: "Discord or a network hiccup interrupted that request. Please try again.",
		};
	}

	// Interaction already acknowledged / expired token — cosmetic, not a bug.
	if (code === 10062 || code === 40060 || /unknown interaction|already acknowledged/i.test(message)) {
		return {
			severity: "low",
			category: "interaction_lifecycle",
			transient: true,
			userMessage: "That action expired before it could complete. Please try again.",
		};
	}

	// Missing permissions — user/server configuration issue, not our bug.
	if (code === 50013 || code === 50001 || /missing permissions|missing access/i.test(message)) {
		return {
			severity: "low",
			category: "permissions",
			transient: false,
			userMessage: "I'm missing a permission needed to do that. Please check my role permissions.",
		};
	}

	// Database / Redis connectivity — infrastructure issue, page the team.
	if (/ECONNREFUSED|redis|postgres|prisma|database/i.test(message) || /ECONNREFUSED/.test(code ?? "")) {
		return {
			severity: "critical",
			category: "infrastructure",
			transient: true,
			userMessage: "A backend service is temporarily unavailable. Please try again shortly.",
		};
	}

	// Anything else is an unexpected bug — treat as high severity so it surfaces.
	return {
		severity: "high",
		category: "unhandled",
		transient: false,
		userMessage: "An unexpected error occurred. This has been reported automatically.",
	};
}

// ─── Alert deduplication + rate limiting ──────────────────────────────────────

interface AlertBucket {
	count: number;
	firstSeen: number;
	lastSent: number;
}

const ALERT_WINDOW_MS = 5 * 60_000; // Group repeats of the same error within 5 minutes
const ALERT_COOLDOWN_MS = 60_000; // Never send more than one alert per unique error per minute
const MAX_ALERTS_PER_MINUTE = 5; // Hard ceiling across ALL errors, protects the webhook from storms

const alertBuckets = new Map<string, AlertBucket>();
let globalAlertWindowStart = Date.now();
let globalAlertCount = 0;

function dedupeKey(category: string, message: string): string {
	// Strip numeric IDs/timestamps so the same bug at different IDs still dedupes.
	const normalized = message.replace(/\d{5,}/g, "#").slice(0, 160);
	return `${category}:${normalized}`;
}

/** Returns true if this error should trigger a fresh webhook alert right now. */
function shouldAlert(category: string, message: string): boolean {
	const now = Date.now();

	// Reset the global per-minute ceiling every 60s.
	if (now - globalAlertWindowStart > 60_000) {
		globalAlertWindowStart = now;
		globalAlertCount = 0;
	}
	if (globalAlertCount >= MAX_ALERTS_PER_MINUTE) return false;

	const key = dedupeKey(category, message);
	const bucket = alertBuckets.get(key);

	if (!bucket) {
		alertBuckets.set(key, { count: 1, firstSeen: now, lastSent: now });
		globalAlertCount++;
		return true;
	}

	bucket.count++;
	if (now - bucket.firstSeen > ALERT_WINDOW_MS) {
		// Window expired — start a fresh tracking window for this error.
		bucket.firstSeen = now;
		bucket.count = 1;
	}
	if (now - bucket.lastSent < ALERT_COOLDOWN_MS) return false;

	bucket.lastSent = now;
	globalAlertCount++;
	return true;
}

// Periodically prune stale buckets so this map never grows unbounded.
setInterval(() => {
	const now = Date.now();
	for (const [key, bucket] of alertBuckets) {
		if (now - bucket.lastSent > ALERT_WINDOW_MS * 2) alertBuckets.delete(key);
	}
}, ALERT_WINDOW_MS).unref?.();

// ─── Structured context ───────────────────────────────────────────────────────

export interface ErrorContext {
	command?: string;
	guildId?: string;
	guildName?: string;
	userId?: string;
	channelId?: string;
	shardId?: number;
	interactionId?: string;
	messageId?: string;
	source: "slash" | "prefix" | "button" | "menu" | "modal" | "autocomplete" | "event" | "process";
}

let webhookClient: WebhookClient | null | undefined;

function getWebhook(): WebhookClient | null {
	if (webhookClient !== undefined) return webhookClient;
	webhookClient = env.ERROR_WEBHOOK_URL ? new WebhookClient({ url: env.ERROR_WEBHOOK_URL }) : null;
	return webhookClient;
}

/**
 * Central entry point: log the error, alert ops if warranted, and return a
 * user-safe reference so support can trace the incident from a bug report.
 */
export async function reportError(
	client: BaseClient,
	error: unknown,
	context: ErrorContext,
): Promise<{ referenceId: string; userMessage: string; classification: ClassifiedError }> {
	const referenceId = generateErrorReference();
	const classification = classifyError(error);
	const rawMessage = error instanceof Error ? error.message : String(error);
	const message = redactSensitive(rawMessage);
	const stack = error instanceof Error && error.stack ? redactSensitive(error.stack) : undefined;

	const logPayload = { referenceId, severity: classification.severity, category: classification.category, ...context };
	const logLine = `[${context.source}:${context.command ?? "unknown"}] ${message}`;

	if (classification.severity === "critical" || classification.severity === "high") {
		client.logger.error(logPayload, logLine);
		if (stack) client.logger.error(stack);
	} else {
		client.logger.warn(logPayload, logLine);
	}

	// Only page the ops webhook for real problems — never for expected transient noise.
	if (!classification.transient && (classification.severity === "high" || classification.severity === "critical")) {
		await maybeSendAlert(client, referenceId, classification, message, stack, context).catch(() => undefined);
	}

	return { referenceId, userMessage: classification.userMessage, classification };
}

async function maybeSendAlert(
	client: BaseClient,
	referenceId: string,
	classification: ClassifiedError,
	message: string,
	stack: string | undefined,
	context: ErrorContext,
): Promise<void> {
	const hook = getWebhook();
	if (!hook) return;
	if (!shouldAlert(classification.category, message)) return;

	const color = classification.severity === "critical" ? 0xdc2626 : 0xf59e0b;
	const embed = new EmbedBuilder()
		.setColor(color)
		.setTitle(`${classification.severity === "critical" ? "CRITICAL" : "HIGH"} — ${classification.category}`)
		.setDescription(`\`\`\`\n${message.slice(0, 500)}\n\`\`\``)
		.addFields(
			{ name: "Reference", value: `\`${referenceId}\``, inline: true },
			{ name: "Source", value: context.source, inline: true },
			{ name: "Command", value: context.command ?? "n/a", inline: true },
			{ name: "Guild", value: context.guildId ? `${context.guildName ?? "unknown"} (${context.guildId})` : "n/a", inline: false },
			{ name: "User", value: context.userId ?? "n/a", inline: true },
			{ name: "Shard", value: context.shardId?.toString() ?? "n/a", inline: true },
		)
		.setTimestamp(new Date());

	if (stack) embed.addFields({ name: "Stack (truncated)", value: `\`\`\`\n${stack.slice(0, 1000)}\n\`\`\`` });

	await hook.send({ embeds: [embed], username: "Elfaria Error Monitor" }).catch((err) => {
		client.logger.error("[error-handler] Failed to deliver alert webhook", err);
	});
}

// ─── Guaranteed interaction acknowledgement ──────────────────────────────────

type RepliableInteraction =
	| ChatInputCommandInteraction
	| ContextMenuCommandInteraction
	| ButtonInteraction
	| StringSelectMenuInteraction
	| ModalSubmitInteraction
	| MessageComponentInteraction;

/**
 * Handle an error that occurred while processing an interaction. This is the
 * function every interaction entry point should funnel failures through — it
 * guarantees the interaction is acknowledged (so Discord never shows
 * "didn't respond in time") and gives the user a safe, referenced message.
 */
export async function handleInteractionError(
	client: BaseClient,
	interaction: RepliableInteraction,
	error: unknown,
	extra?: Partial<ErrorContext>,
): Promise<void> {
	const commandName = "commandName" in interaction ? interaction.commandName : undefined;
	const { referenceId, userMessage } = await reportError(client, error, {
		source: extra?.source ?? "event",
		command: extra?.command ?? commandName,
		guildId: interaction.guildId ?? undefined,
		guildName: interaction.guild?.name,
		userId: interaction.user?.id,
		channelId: interaction.channelId ?? undefined,
		shardId: interaction.guild?.shardId,
		interactionId: interaction.id,
	});

	const content = `${userMessage}\n-# Reference: \`${referenceId}\` · try again in a moment.`;

	try {
		if (!interaction.isRepliable()) return;
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({ content, embeds: [], components: [] }).catch(() =>
				interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined),
			);
		} else {
			await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
		}
	} catch {
		// Never let the error handler itself throw — that would defeat the purpose.
	}
}

/**
 * Last-resort acknowledgement guard. Call this from a catch block whose
 * primary error handling already ran but the interaction might still be
 * unacknowledged (e.g. a component `update()` call failed). This purely
 * exists to prevent the "didn't respond in time" UX failure.
 */
export async function ensureAcknowledged(interaction: RepliableInteraction): Promise<void> {
	if (!interaction.isRepliable()) return;
	if (interaction.deferred || interaction.replied) return;
	try {
		if (interaction.isMessageComponent()) {
			await interaction.deferUpdate();
		} else {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}
	} catch {
		// The interaction token may already be dead (>3s elapsed) — nothing more we can do.
	}
}

/**
 * Handle an error that occurred while processing a prefix (message) command.
 */
export async function handleMessageError(
	client: BaseClient,
	message: Message,
	error: unknown,
	extra?: Partial<ErrorContext>,
): Promise<void> {
	const { referenceId, userMessage } = await reportError(client, error, {
		source: extra?.source ?? "prefix",
		command: extra?.command,
		guildId: message.guildId ?? undefined,
		guildName: message.guild?.name,
		userId: message.author.id,
		channelId: message.channelId,
		shardId: message.guild?.shardId,
		messageId: message.id,
	});

	const content = `${userMessage}\n-# Reference: \`${referenceId}\` · try again in a moment.`;

	try {
		if (message.channel.isSendable()) {
			await message.reply({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
		}
	} catch {
		// Silently fail — we must never throw from inside error handling.
	}
}

/**
 * Handle an error at the process level (uncaughtException / unhandledRejection).
 * These never carry a Discord entity to reply to, so we only log + alert.
 */
export async function handleProcessError(client: BaseClient | null, error: unknown, kind: "uncaughtException" | "unhandledRejection"): Promise<void> {
	const classification = classifyError(error);
	const message = redactSensitive(error instanceof Error ? error.message : String(error));
	const stack = error instanceof Error && error.stack ? redactSensitive(error.stack) : undefined;
	const referenceId = generateErrorReference();

	if (!client) {
		// Bot hasn't finished constructing yet — fall back to console.
		console.error(`[${kind}] [ref:${referenceId}]`, message, stack ?? "");
		return;
	}

	client.logger.error({ referenceId, kind, severity: classification.severity }, `[process:${kind}] ${message}`);
	if (stack) client.logger.error(stack);

	await maybeSendAlert(client, referenceId, { ...classification, severity: "critical" }, message, stack, { source: "process" }).catch(() => undefined);
}

// ─── Backward-compatible aliases (legacy callers) ────────────────────────────

/** @deprecated Use `reportError` instead. Kept for backward compatibility. */
export function handleCommandError(
	logger: { error: (...args: any[]) => void },
	error: unknown,
	context: ErrorContext,
): { referenceId: string; userMessage: string } {
	const referenceId = generateErrorReference();
	const message = error instanceof Error ? error.message : String(error);
	logger.error({ referenceId, ...context }, `[cmd:${context.command ?? "unknown"}] ${redactSensitive(message)}`);
	return { referenceId, userMessage: `An unexpected error occurred. Reference: **${referenceId}**` };
}
