import {
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	MessageFlags,
	MessagePayload,
} from "discord.js";
import { compactReply } from "./compactReply";

/**
 * Safely reply to an interaction, never double-replying.
 * Checks interaction.replied and interaction.deferred before choosing the method.
 */
export async function safeReply(
	interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
	options: string | InteractionReplyOptions | MessagePayload,
): Promise<any> {
	const formatted = compactReply(options);
	if (interaction.replied || interaction.deferred) {
		const editOptions: InteractionEditReplyOptions = typeof formatted === "string"
			? { content: formatted }
			: { ...formatted as any, flags: undefined };

		return interaction.editReply(editOptions).catch(() =>
			interaction.followUp(formatted as any).catch(() => undefined),
		);
	}
	return interaction.reply(formatted as any).catch(() => undefined);
}

/**
 * Safely defer an interaction reply, handling already-replied states.
 */
export async function safeDefer(
	interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
	ephemeral = false,
): Promise<boolean> {
	if (interaction.replied || interaction.deferred) return true;
	try {
		await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
		return true;
	} catch {
		return false;
	}
}

/**
 * Safely edit or follow up a deferred/replied interaction.
 */
export async function safeEditReply(
	interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
	options: string | InteractionReplyOptions | MessagePayload,
): Promise<any> {
	const formatted = compactReply(options);
	if (!interaction.replied && !interaction.deferred) {
		return interaction.reply(formatted as any).catch(() => undefined);
	}
	return interaction.editReply(formatted as any).catch(() =>
		interaction.followUp(formatted as any).catch(() => undefined),
	);
}
