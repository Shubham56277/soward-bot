import { GuildBotSettings } from "@repo/db";
import { ApplicationCommandOptionType, type Attachment, PermissionFlagsBits } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { type BrandingImage, fetchBrandingImage, resetGuildBranding, UnsupportedGuildBrandingError, updateGuildAvatar, updateGuildBanner, updateGuildBio } from "../../utils/botBranding";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { validateBio, validateImageUrl } from "../../utils/botSettingsValidation";
import Help from "../utils/Help";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const imageOption = (name: "avatar" | "banner", description: string): any => ({
	name,
	description,
	type: ApplicationCommandOptionType.Subcommand,
	options: [
		{ name: "file", description: "PNG, JPEG, WebP, or GIF up to 8 MB", type: ApplicationCommandOptionType.Attachment, required: false },
		{ name: "url", description: "Direct HTTPS image URL", type: ApplicationCommandOptionType.String, required: false, max_length: 500 },
	],
});

export default class Customize extends Command {
	public constructor() {
		super({
			name: "customize",
			description: {
				content: "Customize this server's bot branding (server-specific)",
				usage: "customize <avatar|bio|banner|reset>",
				examples: ["customize", "customize avatar <url>", "customize bio Your server assistant", "customize banner <url>", "customize reset"],
			},
			premium: true,
			cooldown: 5,
			slashCommand: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "EmbedLinks", "AttachFiles", "ChangeNickname"],
				user: [PermissionFlagsBits.Administrator],
			},
			options: [
				imageOption("avatar", "Set the bot avatar for this server"),
				{
					name: "bio",
					description: "Set the bot bio for this server",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "text", description: "Branding bio (up to 300 characters)", type: ApplicationCommandOptionType.String, required: true, min_length: 1, max_length: 300 }],
				},
				imageOption("banner", "Set the bot banner for this server"),
				{ name: "reset", description: "Restore this server to the bot's default identity", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			// `?customize` with no subcommand shows the command guide.
			const rawAction = ctx.options.getSubCommand(false, 0);
			if (!rawAction) return this.help(ctx);

			const action = rawAction.toLowerCase();
			if (!["avatar", "bio", "banner", "reset"].includes(action)) return this.help(ctx);

			if (action === "reset") {
				await resetGuildBranding(ctx.client, ctx.guild.id);
				await GuildBotSettings.reset(ctx.guild.id);
				return this.notice(ctx, "Branding reset", `The bot avatar, bio, and banner in **${ctx.guild.name}** were restored to its default identity. Other servers are unaffected.`);
			}

			if (action === "bio") {
				const text = ctx.isInteraction ? ctx.options.getString("text", true) : ctx.args.slice(1).join(" ");
				const bio = validateBio(text, 300);
				if (!bio) return this.notice(ctx, "Invalid branding bio", "Use 1-300 characters without user, role, or mass mentions.");
				await updateGuildBio(ctx.client, ctx.guild.id, bio);
				await GuildBotSettings.update(ctx.guild.id, { bio });
				return this.notice(ctx, "Branding bio updated", `${bio}\n\n-# Applies to **${ctx.guild.name}** only.`);
			}

			const attachment = ctx.options.getAttachment("file", false, 1) as Attachment | undefined;
			const rawUrl = ctx.isInteraction ? ctx.options.getString("url", false) : ctx.args[1];
			const imageUrl = this.resolveImage(attachment, rawUrl);
			if (!imageUrl) return this.notice(ctx, "Invalid image", "Attach a PNG, JPEG, WebP, or GIF up to 8 MB, or provide a direct public HTTPS image URL.");
			let image: BrandingImage;
			try {
				image = await fetchBrandingImage(imageUrl);
			} catch {
				return this.notice(ctx, "Image unavailable", "The image could not be downloaded safely. Check that it is public, uses HTTPS, has a supported file extension, and is no larger than 8 MB.");
			}

			if (action === "avatar") {
				await updateGuildAvatar(ctx.client, ctx.guild.id, image);
				const me = await ctx.guild.members.fetch({ user: ctx.client.user!.id, force: true }).catch(() => null);
				const actualUrl = me?.avatarURL({ extension: "png", size: 1024 }) ?? null;
				await GuildBotSettings.update(ctx.guild.id, { avatarUrl: actualUrl });
				return this.notice(ctx, "Avatar updated", `Discord accepted the new server avatar for **${ctx.guild.name}**.${actualUrl ? `\n[Open current image](${actualUrl})` : ""}\n\n-# Applies to this server only.`);
			}

			await updateGuildBanner(ctx.client, ctx.guild.id, image);
			await GuildBotSettings.update(ctx.guild.id, { bannerUrl: imageUrl });
			return this.notice(ctx, "Banner updated", `Discord accepted the new server banner for **${ctx.guild.name}**.\n\n-# Applies to this server only.`);
		} catch (error) {
			if (error instanceof UnsupportedGuildBrandingError) {
				return this.notice(
					ctx,
					"Not supported by Discord",
					`Discord does not yet allow a bot to use a per-server ${error.field}. Only the **server avatar** can be customized right now. The bot's global ${error.field} is left unchanged so other servers stay unaffected.`,
				);
			}
			return settingsFailure(ctx, error, "customize");
		}
	}

	private resolveImage(attachment: Attachment | undefined, rawUrl: string | null | undefined): string | null {
		if (attachment) {
			if (attachment.size > MAX_IMAGE_BYTES || !attachment.contentType?.startsWith("image/")) return null;
			if (!/^image\/(png|jpe?g|webp|gif)$/i.test(attachment.contentType)) return null;
			return validateImageUrl(attachment.url);
		}
		return rawUrl ? validateImageUrl(rawUrl.trim()) : null;
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return ctx.sendMessage({ components: [settingsPanel(title, body)], flags: SETTINGS_FLAGS });
	}

	private help(ctx: Context): Promise<any> {
		return new Help().showCommand(ctx, "customize");
	}
}
