import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import type Context from "../lib/Context";
import { BrandingRateLimitError } from "./botBranding";
import { reportError } from "./errorHandler";

export const SETTINGS_FLAGS = MessageFlags.IsComponentsV2;

export function settingsPanel(title: string, description: string, sections: Array<[string, string]> = []): ContainerBuilder {
	const panel = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
	for (const [heading, content] of sections) {
		panel
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${heading}**\n${content}`));
	}
	return panel;
}

export async function settingsFailure(ctx: Context, error: unknown, command: string): Promise<any> {
	await reportError(ctx.client, error, {
		source: ctx.isInteraction ? "slash" : "prefix",
		command,
		guildId: ctx.guild.id,
		userId: ctx.author?.id,
		interactionId: ctx.interaction?.id,
		messageId: ctx.message?.id,
	});
	const description =
		error instanceof BrandingRateLimitError
			? `Discord is temporarily limiting bot identity changes. Try again in about ${error.retryAfterSeconds} seconds.`
			: "The operation could not be completed. Discord or storage may be temporarily unavailable; review the current settings before retrying.";
	return ctx.sendMessage({
		components: [settingsPanel("Settings unavailable", description)],
		flags: SETTINGS_FLAGS | (ctx.isInteraction ? MessageFlags.Ephemeral : 0),
	});
}
