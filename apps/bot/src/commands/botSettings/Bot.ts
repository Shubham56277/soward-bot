import { Guild, GuildBotSettings } from "@repo/db";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { checkPremium } from "../../utils/premiumCheck";

export default class BotSettings extends Command {
	public constructor() {
		super({
			name: "bot",
			description: { content: "Open the separate Bot Settings dashboard", usage: "bot", examples: ["bot"] },
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const [guild, branding, premium] = await Promise.all([Guild.get(ctx.guild.id), GuildBotSettings.get(ctx.guild.id), checkPremium(ctx.client.redis, ctx.author!.id, ctx.guild)]);
			const prefixes = [...new Set([guild?.prefix ?? ctx.client.config.prefix, ...(guild?.prefixes ?? [])])];
			const panel = settingsPanel("Bot Settings", "A dedicated workspace for profiles, premium branding, and server prefixes.", [
				["Profile", "`profile [user]` · `bio [user]` · `bio set/clear` · `badge add/list/remove`"],
				["Premium Branding", premium ? "`customize` · `customize avatar/bio/banner/reset` · **Unlocked**" : "**Locked** · Redeem access with `/premium redeem <code>`"],
				["Prefix", `Primary \`${prefixes[0]}\` · ${prefixes.length} active\n\`prefix show/set/add/remove/reset\``],
				["Server branding", branding.bio || (branding.avatarUrl || branding.bannerUrl ? "Custom media configured" : "Using defaults")],
			]);
			const links = ctx.client.config.links as Record<string, string | undefined>;
			const premiumUrl = links.premium ?? links.website ?? links.supportServer ?? ctx.client.config.links.invite;
			const supportUrl = links.supportServer ?? ctx.client.config.links.invite;
			panel.addActionRowComponents(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setLabel("Premium").setStyle(ButtonStyle.Link).setURL(premiumUrl),
					new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(supportUrl),
				),
			);
			return ctx.sendMessage({ components: [panel], flags: SETTINGS_FLAGS });
		} catch (error) {
			return settingsFailure(ctx, error, "bot");
		}
	}
}
