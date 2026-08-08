import { UserProfile } from "@repo/db";
import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { profileCardRenderer, sanitizeProfileText } from "../../services/profile/ProfileCardRenderer";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";

const MAX_BIO_LENGTH = 190;
const NO_MENTIONS = { parse: [] as const, repliedUser: false };
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;
const MENTION_PATTERN = /<@!?\d+>|<@&\d+>|@(everyone|here)/i;

/** Applies the same code-point and mention policy to slash and prefix input. */
export function normalizeProfileBio(value: unknown): string | null {
	const bio = String(value ?? "").normalize("NFKC").trim();
	if (!bio || Array.from(bio).length > MAX_BIO_LENGTH || CONTROL_PATTERN.test(bio) || MENTION_PATTERN.test(bio)) return null;
	return bio;
}

export default class Bio extends Command {
	public constructor() {
		super({
			name: "bio",
			description: { content: "View or manage your profile bio", usage: "bio <show|set|clear> [text]", examples: ["bio", "bio set Music and moderation", "bio clear"] },
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [
				{
					name: "show",
					description: "Show a profile bio",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to view", type: ApplicationCommandOptionType.User, required: false }],
				},
				{
					name: "set",
					description: "Set your profile bio",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "text", description: "Your bio (up to 190 characters)", type: ApplicationCommandOptionType.String, required: true, min_length: 1, max_length: MAX_BIO_LENGTH }],
				},
				{ name: "clear", description: "Clear your profile bio", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const action = (ctx.options.getSubCommand(false, 0) ?? "show").toLowerCase();
			if (action === "show") {
				const resolvedUser = ctx.options.getUser("user", false, 1);
				if (!ctx.isInteraction && ctx.args[1] && !resolvedUser) {
					return ctx.sendMessage({ components: [settingsPanel("User not found", "Mention a server member or provide a valid user ID.")], flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
				}
				const user = resolvedUser ?? ctx.author!;
				const profile = await UserProfile.get(user.id);
				const username = sanitizeProfileText(user.username, 32) || "Unknown user";
				const bio = sanitizeProfileText(profile.bio, MAX_BIO_LENGTH) || "No bio has been set yet.";
				return ctx.sendMessage({ components: [settingsPanel(`${username}'s bio`, bio)], flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
			}
			if (action === "clear") {
				await UserProfile.update(ctx.author!.id, { bio: null });
				profileCardRenderer.invalidateUser(ctx.author!.id);
				return ctx.sendMessage({ content: "<:tick:1533150498973155490> Bio cleared.", allowedMentions: NO_MENTIONS });
			}
			if (action !== "set") {
				return ctx.sendMessage({ components: [settingsPanel("Bio commands", "Use `bio show`, `bio set <text>`, or `bio clear`.")], flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
			}
			const raw = ctx.isInteraction ? ctx.options.getString("text", true) : ctx.args.slice(1).join(" ");
			const bio = normalizeProfileBio(raw);
			if (!bio) {
				return ctx.sendMessage({ components: [settingsPanel("Invalid bio", "Use 1-190 visible characters. User, role, and mass mentions are not allowed.")], flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
			}
			await UserProfile.update(ctx.author!.id, { bio });
			profileCardRenderer.invalidateUser(ctx.author!.id);
			return ctx.sendMessage({ content: "<:tick:1533150498973155490> Bio updated.", allowedMentions: NO_MENTIONS });
		} catch (error) {
			return settingsFailure(ctx, error, "bio");
		}
	}
}