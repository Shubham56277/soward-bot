import { UserProfile } from "@repo/db";
import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { profileCardRenderer } from "../../services/profile/ProfileCardRenderer";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { validateBio } from "../../utils/botSettingsValidation";

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
					options: [{ name: "text", description: "Your bio (up to 190 characters)", type: ApplicationCommandOptionType.String, required: true, min_length: 1, max_length: 190 }],
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
					return ctx.sendMessage({ components: [settingsPanel("User not found", "Mention a server member or provide a valid user ID.")], flags: SETTINGS_FLAGS });
				}
				const user = resolvedUser ?? ctx.author!;
				const profile = await UserProfile.get(user.id);
				return ctx.sendMessage({ components: [settingsPanel(`${user.username}'s bio`, profile.bio || "No bio has been set yet.")], flags: SETTINGS_FLAGS });
			}
			if (action === "clear") {
				await UserProfile.update(ctx.author!.id, { bio: null });
				profileCardRenderer.invalidateUser(ctx.author!.id);
				return ctx.sendMessage({ content: "<:tick:1533150498973155490> Bio cleared.", allowedMentions: { parse: [] } });
			}
			if (action !== "set") return ctx.sendMessage({ components: [settingsPanel("Bio commands", "Use `bio show`, `bio set <text>`, or `bio clear`.")], flags: SETTINGS_FLAGS });
			const text = ctx.isInteraction ? ctx.options.getString("text", true) : ctx.args.slice(1).join(" ");
			const bio = validateBio(text, 190);
			if (!bio) {
				return ctx.sendMessage({ components: [settingsPanel("Invalid bio", "Use 1-190 characters. User, role, and mass mentions are not allowed.")], flags: SETTINGS_FLAGS });
			}
			await UserProfile.update(ctx.author!.id, { bio });
			profileCardRenderer.invalidateUser(ctx.author!.id);
			return ctx.sendMessage({ content: "<:tick:1533150498973155490> Bio updated.", allowedMentions: { parse: [] } });
		} catch (error) {
			return settingsFailure(ctx, error, "bio");
		}
	}
}
