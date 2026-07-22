import { ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Context from "../lib/Context";

export function createInfoPanel(ctx: Context, title: string, subtitle: string, rows: Array<[string, string]>): ContainerBuilder {
	return new ContainerBuilder()
		.setAccentColor(ctx.client.config.colors.main)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n-# **${subtitle}**`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(rows.map(([label, value]) => `› **${label}** ${value}`).join("\n")),
		);
}
