import { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Generate a short error reference ID for user-facing error messages.
 */
export function generateErrorReference(): string {
	return randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Redact sensitive information from error messages before logging or displaying.
 */
export function redactSensitive(input: string): string {
	return input
		.replace(/(?:mfa\.[\w-]+|[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,27})/g, "[TOKEN_REDACTED]")
		.replace(/(?:postgres|postgresql):\/\/[^@]+@/g, "postgres://[CREDENTIALS_REDACTED]@")
		.replace(/redis:\/\/[^@]+@/g, "redis://[CREDENTIALS_REDACTED]@")
		.replace(/api[-_]?key[=:]["']?[\w-]+/gi, "api_key=[REDACTED]");
}

export interface ErrorContext {
	command?: string;
	guildId?: string;
	userId?: string;
	shardId?: number;
	interactionId?: string;
	messageId?: string;
}

/**
 * Log an error with structured context and return a user-safe reference ID.
 */
export function handleCommandError(
	logger: { error: (...args: any[]) => void },
	error: unknown,
	context: ErrorContext,
): { referenceId: string; userMessage: string } {
	const referenceId = generateErrorReference();
	const errorMessage = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;

	logger.error(
		{
			referenceId,
			...context,
			...(stack ? { stack: redactSensitive(stack) } : {}),
		},
		`[cmd:${context.command ?? "unknown"}] ${redactSensitive(errorMessage)}`,
	);

	return {
		referenceId,
		userMessage: `An unexpected error occurred. Reference: **${referenceId}**`,
	};
}

/**
 * Handle an error during interaction execution with safe user-facing response.
 */
export async function handleInteractionError(
	logger: { error: (...args: any[]) => void },
	interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
	error: unknown,
	commandName?: string,
): Promise<void> {
	const { referenceId, userMessage } = handleCommandError(logger, error, {
		command: commandName ?? interaction.commandName,
		guildId: interaction.guildId ?? undefined,
		userId: interaction.user.id,
		shardId: interaction.guild?.shardId,
		interactionId: interaction.id,
	});

	const content = `${userMessage}\n-# Please try again in a moment.`;

	try {
		if (interaction.replied || interaction.deferred) {
			await interaction.editReply({ content, embeds: [], components: [] }).catch(() =>
				interaction.followUp({ content, flags: 64 }).catch(() => undefined),
			);
		} else if (interaction.isRepliable()) {
			await interaction.reply({ content, flags: 64 }).catch(() => undefined);
		}
	} catch {
		// Silently fail at this point — we don't want to cascade errors
	}
}

/**
 * Handle an error during message command execution.
 */
export async function handleMessageError(
	logger: { error: (...args: any[]) => void },
	message: Message,
	error: unknown,
	commandName?: string,
): Promise<void> {
	const { referenceId, userMessage } = handleCommandError(logger, error, {
		command: commandName,
		guildId: message.guildId ?? undefined,
		userId: message.author.id,
		shardId: message.guild?.shardId,
		messageId: message.id,
	});

	const content = `${userMessage}\n-# Please try again in a moment.`;

	try {
		await message.reply({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
	} catch {
		// Silently fail
	}
}
