import { Premium as PremiumAccount, PremiumCode } from "@repo/db";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Premium extends Command {
	public constructor() {
		super({
			name: "premium",
			description: {
				content: "Check premium status or redeem an activation code",
				examples: ["premium status", "premium redeem SWRD-..."],
				usage: "premium <status|redeem> [code]",
			},
			category: "utils",
			cooldown: 3,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [
				{ name: "status", description: "Show your premium status", type: ApplicationCommandOptionType.Subcommand },
				{
					name: "redeem",
					description: "Redeem a one-time premium activation code",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "code",
							description: "The activation code supplied by the bot owner",
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const action = (ctx.options.getSubCommand(false, 0) ?? "status").toLowerCase();
		if (action === "status") {
			const premium = await PremiumAccount.get(ctx.author!.id);
			const active = Boolean(premium.isPremium && premium.premiumUntil && premium.premiumUntil.getTime() > Date.now());
			return ctx.sendMessage({
				components: [this.statusView(ctx, active, premium.premiumUntil || null)],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		if (action !== "redeem") {
			return ctx.sendMessage({
				components: [this.noticeView(ctx, "Premium command", "Use `/premium status` or `/premium redeem code:<activation-code>`." )],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const code = ctx.isInteraction ? ctx.options.getString("code", true) : ctx.args[1];
		if (!code) {
			return ctx.sendMessage({
				components: [this.noticeView(ctx, "Activation code required", "Use the private activation code supplied by the bot owner.")],
				flags: this.privateV2Flags(ctx),
			});
		}

		const result = await PremiumCode.redeem(code, ctx.author!.id);
		if (result.status !== "redeemed") {
			const messages = {
				invalid: "This activation code is not valid.",
				used: "This activation code has already been redeemed.",
				expired: "This activation code has expired.",
			};
			return ctx.sendMessage({
				components: [this.noticeView(ctx, "Activation unsuccessful", messages[result.status])],
				flags: this.privateV2Flags(ctx),
			});
		}

		return ctx.sendMessage({
			components: [this.activatedView(ctx, result.premiumUntil)],
			flags: this.privateV2Flags(ctx),
		});
	}

	private statusView(ctx: Context, active: boolean, expiresAt: Date | null): ContainerBuilder {
		const botName = ctx.client.user?.username || "Soward";
		const avatar = ctx.client.user?.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png";
		const heading = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## ${botName} Premium\n-# **Private tools for music and voice.**`),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${botName} profile picture`));
		const memberName = ctx.author?.username ?? "Unknown user";
		const status = active
			? `› **Status** ACTIVE\n› **Member** ${memberName}\n› **Expires** <t:${Math.floor(expiresAt!.getTime() / 1_000)}:R>`
			: `› **Status** LOCKED\n› **Member** ${memberName}\n› **Access** Owner activation code`;
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("premium_state").setLabel(active ? "Premium Active" : "Premium Locked").setStyle(active ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(true),
			new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.supportServer),
			new ButtonBuilder().setLabel("Invite Bot").setStyle(ButtonStyle.Link).setURL(ctx.client.config.links.invite),
		);

		return new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addSectionComponents(heading)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(status))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					"**Included**\n-# **Voice recording**\n-# **Uploaded-file playback**\n-# **AI conversations with provider fallback**\n-# **Autoplay and 24/7 mode**",
				),
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					active
						? "-# **Use `/ai status` to check AI or `/help premium` for every premium command.**"
						: "-# **Activate with `/premium redeem code:<code>`.**",
				),
			)
			.addActionRowComponents(row);
	}

	private activatedView(ctx: Context, expiresAt: Date): ContainerBuilder {
		return new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Premium Activated\n-# **Your private access is ready.**"))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`› **Status** ACTIVE\n› **Valid until** <t:${Math.floor(expiresAt.getTime() / 1_000)}:F>\n› **Remaining** <t:${Math.floor(expiresAt.getTime() / 1_000)}:R>\n\n-# **Use \`/premium status\` to check access.**`,
				),
			);
	}

	private noticeView(ctx: Context, title: string, description: string): ContainerBuilder {
		return new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n-# **${description}**`));
	}

	private privateV2Flags(ctx: Context): number {
		return ctx.isInteraction ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2;
	}
}
