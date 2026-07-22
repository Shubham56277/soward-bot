import {
	ButtonInteraction,
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	MessagePayload,
	StringSelectMenuInteraction,
} from "discord.js";
import { compactReply } from "./compactReply";

type AnyInteraction =
	| ChatInputCommandInteraction
	| ContextMenuCommandInteraction
	| ButtonInteraction
	| StringSelectMenuInteraction;

/**
 * Safely reply to any interaction type without causing "Already acknowledged" errors.
 * Handles all states: unreplied, deferred, replied, and expired.
 */
export async function safeInteractionReply(
	interaction: AnyInteraction,
	options: string | InteractionReplyOptions | MessagePayload,
): Promise<any> {
	const formatted = compactReply(options);

	if (interaction.replied || interaction.deferred) {
		const editOptions: InteractionEditReplyOptions = typeof formatted === "string"
			? { content: formatted }
			: { ...formatted as any, flags: undefined };

		try {
			return await interaction.editReply(editOptions);
		} catch {
			try {
				return await interaction.followUp(formatted as any);
			} catch {
				return undefined;
			}
		}
	}

	try {
		return await interaction.reply(formatted as any);
	} catch {
		return undefined;
	}
}

/**
 * Update an interaction component safely (button, select menu).
 */
export async function safeUpdate(
	interaction: ButtonInteraction | StringSelectMenuInteraction,
	options: any,
): Promise<any> {
	try {
		if (interaction.deferred || interaction.replied) {
			return await interaction.editReply(options);
		}
		return await interaction.update(options);
	} catch {
		return undefined;
	}
}

/**
 * Check if an interaction is still valid for a response.
 */
export function isInteractionValid(interaction: AnyInteraction): boolean {
	try {
		return interaction.isRepliable() && !interaction.replied && !interaction.deferred;
	} catch {
		return false;
	}
}
