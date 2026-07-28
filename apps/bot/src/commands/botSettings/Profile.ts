import { Premium, User as StoredUser, UserProfile } from "@repo/db";
import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";

const BADGE_LABELS: Record<string, string> = {
	community: "Community",
	creator: "Creator",
	gamer: "Gamer",
	helper: "Helper",
	music: "Music Lover",
	supporter: "Supporter",
};

export default class Profile extends Command {
	public constructor() {
		super({
			name: "profile",
			description: { content: "View an Elfaria user profile", examples: ["profile", "profile @user"], usage: "profile [user]" },
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [{ name: "user", description: "Profile to view", type: ApplicationCommandOptionType.User, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const resolvedUser = ctx.options.getUser("user", false, 0);
			if (!ctx.isInteraction && ctx.args[0] && !resolvedUser) {
				return ctx.sendMessage({ components: [settingsPanel("User not found", "Mention a server member or provide a valid user ID.")], flags: SETTINGS_FLAGS });
			}
			const user = resolvedUser ?? ctx.author!;
			const [stored, premium, profile, member] = await Promise.all([StoredUser.get(user.id), Premium.get(user.id), UserProfile.get(user.id), ctx.guild.members.fetch(user.id).catch(() => null)]);
			const premiumActive = Boolean(premium.isPremium && premium.premiumUntil && premium.premiumUntil.getTime() > Date.now());
			const noPrefix = Boolean(stored.noPrefix && (!stored.noPrefixExpiresAt || stored.noPrefixExpiresAt.getTime() > Date.now()));
			const badges = profile.badges.map((badge) => BADGE_LABELS[badge]).filter(Boolean);
			return ctx.sendMessage({
				components: [
					settingsPanel(`${user.username}'s profile`, profile.bio || "No bio has been set yet.", [
						["Badges", badges.length ? badges.map((badge) => `\`${badge}\``).join("  ") : "None"],
						["Access", `Premium **${premiumActive ? "Active" : "Inactive"}** · No Prefix **${noPrefix ? "Active" : "Inactive"}**`],
						["Server", member?.joinedTimestamp ? `Joined <t:${Math.floor(member.joinedTimestamp / 1_000)}:R> · ${Math.max(0, member.roles.cache.size - 1)} roles` : "Not a current member"],
					]),
				],
				flags: SETTINGS_FLAGS,
			});
		} catch (error) {
			return settingsFailure(ctx, error, "profile");
		}
	}
}

export { BADGE_LABELS };
