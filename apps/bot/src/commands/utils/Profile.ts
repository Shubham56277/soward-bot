import { Premium, User as StoredUser } from "@repo/db";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class Profile extends Command {
	public constructor() {
		super({
			name: "profile",
			description: { content: "View a member's Elfaria access profile", examples: ["profile", "profile @user"], usage: "profile [user]" },
			category: "utils",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
			options: [{ name: "user", description: "Member profile to view", type: ApplicationCommandOptionType.User, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", false, 0) ?? ctx.author!;
		const [stored, premium, member] = await Promise.all([
			StoredUser.get(user.id),
			Premium.get(user.id),
			ctx.guild.members.fetch(user.id).catch(() => null),
		]);
		const premiumActive = Boolean(premium.isPremium && premium.premiumUntil && premium.premiumUntil.getTime() > Date.now());
		const noPrefix = Boolean(stored.noPrefix && (!stored.noPrefixExpiresAt || stored.noPrefixExpiresAt.getTime() > Date.now()));
		return ctx.sendMessage({
			components: [createInfoPanel(ctx, `${user.username} Profile`, "Elfaria account access.", [
				["User ID", `\`${user.id}\``],
				["Premium", premiumActive ? "Active" : "Inactive"],
				["No Prefix", noPrefix ? "Active" : "Inactive"],
				["Server Join", member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1_000)}:R>` : "Not in this server"],
				["Roles", member ? Math.max(0, member.roles.cache.size - 1).toString() : "0"],
			])],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
