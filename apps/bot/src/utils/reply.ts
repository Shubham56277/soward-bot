import { EmbedBuilder, type ColorResolvable } from "discord.js";
import type Context from "../lib/Context";
import { constants } from "../config/constants";

// ─── Emoji shortcuts ────────────────────────────────────────────────────────
const TICK = constants.emojis.on;
const CROSS = constants.emojis.off;
const TIME = constants.emojis.time;

// ─── Low-level builder ──────────────────────────────────────────────────────

interface ReplyEmbedOptions {
	color: ColorResolvable;
	description: string;
	/** Prepended emoji — pass `null` to skip. */
	emoji?: string | null;
}

/** Build a minimal description-only embed. */
function buildReplyEmbed({ color, description, emoji }: ReplyEmbedOptions): EmbedBuilder {
	const text = emoji ? `${emoji} ${description}` : description;
	return new EmbedBuilder().setColor(color).setDescription(text);
}

// ─── High-level helpers ─────────────────────────────────────────────────────

/**
 * Send a success response (black embed with tick emoji).
 *
 * ```ts
 * return reply.success(ctx, "Nickname updated");
 * ```
 */
export function success(ctx: Context, message: string) {
	return ctx.sendMessage({
		embeds: [buildReplyEmbed({ color: 0x000000, description: message, emoji: TICK })],
	});
}

/**
 * Send an error response (black embed with cross emoji).
 *
 * ```ts
 * return reply.error(ctx, "User not found");
 * ```
 */
export function error(ctx: Context, message: string) {
	return ctx.sendMessage({
		embeds: [buildReplyEmbed({ color: 0x000000, description: message, emoji: CROSS })],
	});
}

/**
 * Send a warning response (black embed, no emoji by default).
 *
 * ```ts
 * return reply.warning(ctx, "This action cannot be undone");
 * ```
 */
export function warning(ctx: Context, message: string) {
	return ctx.sendMessage({
		embeds: [buildReplyEmbed({ color: 0x000000, description: message })],
	});
}

/**
 * Send a cooldown/rate-limit response using Discord subtext formatting.
 * The message auto-deletes after `deleteAfterMs` (default 4 seconds).
 *
 * ```ts
 * return reply.cooldown(ctx, 5);
 * ```
 */
export async function cooldown(ctx: Context, remainingSeconds: number, deleteAfterMs = 4_000) {
	const text = `-# ${TIME} Slow down — try again <t:${Math.floor(Date.now() / 1000) + remainingSeconds}:R>`;
	const msg = await ctx.sendMessage(text);
	if (msg && deleteAfterMs > 0) {
		setTimeout(() => msg.delete?.().catch(() => undefined), deleteAfterMs).unref();
	}
	return msg;
}

/**
 * Send an informational response (black embed, no emoji).
 *
 * ```ts
 * return reply.info(ctx, "This user has no warnings");
 * ```
 */
export function info(ctx: Context, message: string) {
	return ctx.sendMessage({
		embeds: [buildReplyEmbed({ color: 0x000000, description: message })],
	});
}

/**
 * Send a plain subtext message (compact `-#` formatting).
 * Useful for ephemeral status messages.
 *
 * ```ts
 * return reply.subtext(ctx, "Processing your request...");
 * ```
 */
export function subtext(ctx: Context, message: string) {
	return ctx.sendMessage(`-# ${message}`);
}

/**
 * Send a temporary message that deletes itself after `ms` milliseconds.
 *
 * ```ts
 * return reply.temporary(ctx, "Done!", 3000);
 * ```
 */
export async function temporary(ctx: Context, message: string, ms = 3_000) {
	const msg = await ctx.sendMessage(message);
	if (msg && ms > 0) {
		setTimeout(() => msg.delete?.().catch(() => undefined), ms).unref();
	}
	return msg;
}
