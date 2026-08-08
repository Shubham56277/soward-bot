import { ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder, type ColorResolvable } from "discord.js";
import type Context from "../lib/Context";
import { constants } from "../config/constants";

// ─── Emoji shortcuts ────────────────────────────────────────────────────────
const TICK = constants.emojis.on;
const CROSS = constants.emojis.off;
const TIME = constants.emojis.time;

// ─── V2 Panel Builder ───────────────────────────────────────────────────────

function buildV2Panel(text: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

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
 * Send a success response (Components V2 panel).
 */
export function success(ctx: Context, message: string) {
	return ctx.sendMessage({
		components: [buildV2Panel(message)],
		flags: MessageFlags.IsComponentsV2,
	});
}

/**
 * Send an error response (Components V2 panel).
 */
export function error(ctx: Context, message: string) {
	return ctx.sendMessage({
		components: [buildV2Panel(message)],
		flags: MessageFlags.IsComponentsV2,
	});
}

/**
 * Send a warning response (Components V2 panel).
 */
export function warning(ctx: Context, message: string) {
	return ctx.sendMessage({
		components: [buildV2Panel(message)],
		flags: MessageFlags.IsComponentsV2,
	});
}

/**
 * Send an info response (Components V2 panel).
 */
export function info(ctx: Context, message: string) {
	return ctx.sendMessage({
		components: [buildV2Panel(message)],
		flags: MessageFlags.IsComponentsV2,
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
 * Send a plain subtext message (compact `-#` formatting).
 * Useful for ephemeral status messages.
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
