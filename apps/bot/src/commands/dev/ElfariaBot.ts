import { type Attachment } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { type BrandingImage, fetchBrandingImage, readGlobalBranding, updateGlobalAvatar, updateGlobalBanner, updateGlobalBio } from "../../utils/botBranding";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { validateBio, validateImageUrl } from "../../utils/botSettingsValidation";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BIO_LENGTH = 400;

/**
 * Developer-only control for the bot's GLOBAL account identity (avatar, banner,
 * application bio). Unlike `customize`, these changes apply to the bot account
 * everywhere it is installed. Intentionally prefix-only and excluded from the
 * public help menu.
 */
export default class ElfariaBot extends Command {
	public constructor() {
		super({
			name: "elfariabot",
			description: {
				content: "Developer tools for the bot's global identity",
				usage: "elfariabot <show|avatar|bio|banner>",
				examples: ["elfariabot", "elfariabot show", "elfariabot avatar <url>", "elfariabot bio The all-in-one assistant", "elfariabot banner <url>"],
			},
			category: "dev",
			cooldown: 5,
			slashCommand: false,
			permissions: { dev: true, client: ["SendMessages", "ViewChannel", "EmbedLinks", "AttachFiles"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const action = (ctx.args[0] ?? "").toLowerCase();
			if (!action) return this.dashboard(ctx);
			if (action === "show") return this.show(ctx);
			if (!["avatar", "bio", "banner"].includes(action)) return this.dashboard(ctx);

			if (action === "bio") {
				const text = ctx.args.slice(1).join(" ");
				const bio = validateBio(text, MAX_BIO_LENGTH);
				if (!bio) return this.notice(ctx, "Invalid bio", `Use 1-${MAX_BIO_LENGTH} characters without user, role, or mass mentions.`);
				await updateGlobalBio(ctx.client, bio);
				return this.notice(ctx, "Global bio updated", `${bio}\n\n-# Applies to the bot everywhere.`);
			}

			const attachment = ctx.options.getAttachment("file", false, 1) as Attachment | undefined;
			const imageUrl = this.resolveImage(attachment, ctx.args[1]);
			if (!imageUrl) return this.notice(ctx, "Invalid image", "Attach a PNG, JPEG, WebP, or GIF up to 8 MB, or provide a direct public HTTPS image URL.");
			let image: BrandingImage;
			try {
				image = await fetchBrandingImage(imageUrl);
			} catch {
				return this.notice(ctx, "Image unavailable", "The image could not be downloaded safely. Check that it is public, uses HTTPS, has a supported file extension, and is no larger than 8 MB.");
			}

			if (action === "avatar") {
				await updateGlobalAvatar(ctx.client, image);
				const actualUrl = ctx.client.user!.avatarURL({ extension: "png", size: 1024 });
				return this.notice(ctx, "Global avatar updated", `Discord accepted the new bot avatar.${actualUrl ? `\n[Open current image](${actualUrl})` : ""}\n\n-# Applies to the bot everywhere.`);
			}

			await updateGlobalBanner(ctx.client, image);
			const bannerUrl = ctx.client.user!.bannerURL({ extension: "png", size: 1024 });
			return this.notice(ctx, "Global banner updated", `Discord accepted the new bot banner.${bannerUrl ? `\n[Open current image](${bannerUrl})` : ""}\n\n-# Applies to the bot everywhere.`);
		} catch (error) {
			return settingsFailure(ctx, error, "elfariabot");
		}
	}

	private resolveImage(attachment: Attachment | undefined, rawUrl: string | undefined): string | null {
		if (attachment) {
			if (attachment.size > MAX_IMAGE_BYTES || !attachment.contentType?.startsWith("image/")) return null;
			if (!/^image\/(png|jpe?g|webp|gif)$/i.test(attachment.contentType)) return null;
			return validateImageUrl(attachment.url);
		}
		return rawUrl ? validateImageUrl(rawUrl.trim()) : null;
	}

	private async show(ctx: Context): Promise<any> {
		const branding = await readGlobalBranding(ctx.client);
		return ctx.sendMessage({
			components: [
				settingsPanel("Global bot identity", branding.bio || "No application bio is set.", [
					["Avatar", branding.avatarUrl ? `[Open image](${branding.avatarUrl})` : "Default Discord avatar"],
					["Banner", branding.bannerUrl ? `[Open image](${branding.bannerUrl})` : "Not set"],
					["Scope", "These settings change the bot account **everywhere** it is installed."],
				]),
			],
			flags: SETTINGS_FLAGS,
		});
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return ctx.sendMessage({ components: [settingsPanel(title, body)], flags: SETTINGS_FLAGS });
	}

	private dashboard(ctx: Context): Promise<any> {
		return ctx.sendMessage({
			components: [
				settingsPanel(
					"Elfaria global identity (Developer)",
					"Set the bot's global account identity. Every change applies to the bot **everywhere** it is installed, not to a single server.",
					[
						["Avatar", "`elfariabot avatar <image url>` or attach an image\nSet the bot's global avatar."],
						["Bio", `\`elfariabot bio <text>\`\nSet the bot's global bio (up to ${MAX_BIO_LENGTH} characters).`],
						["Banner", "`elfariabot banner <image url>` or attach an image\nSet the bot's global banner."],
						["Show", "`elfariabot show`\nPreview the bot's current global identity."],
					],
				),
			],
			flags: SETTINGS_FLAGS,
		});
	}
}
