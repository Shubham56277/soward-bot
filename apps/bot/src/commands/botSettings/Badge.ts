import { UserProfile } from "@repo/db";
import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { BADGE_LABELS } from "./Profile";

const choices = Object.entries(BADGE_LABELS).map(([value, name]) => ({ name, value }));
const MAX_BADGES = 3;

const badgeOption = (name: "add" | "remove", description: string): any => ({
	name,
	description,
	type: ApplicationCommandOptionType.Subcommand,
	options: [{ name: "badge", description: "Cosmetic badge", type: ApplicationCommandOptionType.String, required: true, choices }],
});

export default class Badge extends Command {
	public constructor() {
		super({
			name: "badge",
			description: { content: "Manage cosmetic profile badges", usage: "badge <add|list|remove> [badge]", examples: ["badge list", "badge add supporter", "badge remove supporter"] },
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [
				badgeOption("add", "Add a cosmetic badge to your profile"),
				{
					name: "list",
					description: "List profile badges",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to view", type: ApplicationCommandOptionType.User, required: false }],
				},
				badgeOption("remove", "Remove a cosmetic badge from your profile"),
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const action = (ctx.options.getSubCommand(false, 0) ?? "list").toLowerCase();
			if (action === "list") {
				const resolvedUser = ctx.options.getUser("user", false, 1);
				if (!ctx.isInteraction && ctx.args[1] && !resolvedUser) {
					return this.notice(ctx, "User not found", "Mention a server member or provide a valid user ID.");
				}
				const user = resolvedUser ?? ctx.author!;
				const profile = await UserProfile.get(user.id);
				const labels = profile.badges.map((badge) => BADGE_LABELS[badge]).filter(Boolean);
				return ctx.sendMessage({
					components: [settingsPanel(`${user.username}'s badges`, labels.length ? labels.map((label) => `\`${label}\``).join("  ") : "No cosmetic badges selected.")],
					flags: SETTINGS_FLAGS,
				});
			}
			if (action !== "add" && action !== "remove") return this.usage(ctx);
			const badge = (ctx.isInteraction ? ctx.options.getString("badge", true) : ctx.args[1])?.toLowerCase();
			if (!badge || !BADGE_LABELS[badge]) return this.usage(ctx);
			const profile = await UserProfile.get(ctx.author!.id);
			if (action === "add") {
				if (profile.badges.includes(badge)) return this.notice(ctx, "Badge already selected", `\`${BADGE_LABELS[badge]}\` is already on your profile.`);
				if (profile.badges.length >= MAX_BADGES) return this.notice(ctx, "Badge limit reached", `Remove a badge before adding another. Profiles support ${MAX_BADGES} cosmetic badges.`);
				await UserProfile.update(ctx.author!.id, { badges: [...profile.badges, badge] });
				return this.notice(ctx, "Badge added", `\`${BADGE_LABELS[badge]}\` is now on your profile.`);
			}
			if (!profile.badges.includes(badge)) return this.notice(ctx, "Badge not selected", `\`${BADGE_LABELS[badge]}\` is not on your profile.`);
			await UserProfile.update(ctx.author!.id, { badges: profile.badges.filter((value) => value !== badge) });
			return this.notice(ctx, "Badge removed", `\`${BADGE_LABELS[badge]}\` was removed from your profile.`);
		} catch (error) {
			return settingsFailure(ctx, error, "badge");
		}
	}
	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return ctx.sendMessage({ components: [settingsPanel(title, body)], flags: SETTINGS_FLAGS });
	}

	private usage(ctx: Context): Promise<any> {
		return this.notice(ctx, "Badge commands", `Choose one of: ${choices.map((choice) => `\`${choice.value}\``).join("  ")}\nUse \`badge add\`, \`badge list\`, or \`badge remove\`.`);
	}
}
