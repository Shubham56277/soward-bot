import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class JoinedAt extends Command {
	public constructor() {
		super({
			name: "joinedat",
			description: { content: "Show when a member joined this server", examples: ["joinedat", "joinedat @user"], usage: "joinedat [user]" },
			category: "utils",
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
			options: [{ name: "user", description: "Member to inspect", type: ApplicationCommandOptionType.User, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", false) ?? ctx.author!;
		const member = await ctx.guild.members.fetch(user.id).catch(() => null);
		if (!member?.joinedTimestamp) return ctx.sendMessage("That user is not a member of this server.");
		return ctx.sendMessage({
			components: [createInfoPanel(ctx, "Member Timeline", "Server membership information.", [
				["Member", `${user.username} (\`${user.id}\`)`],
				["Joined", `<t:${Math.floor(member.joinedTimestamp / 1_000)}:F>`],
				["Relative", `<t:${Math.floor(member.joinedTimestamp / 1_000)}:R>`],
			])],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
