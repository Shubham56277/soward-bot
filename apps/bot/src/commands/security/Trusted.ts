import { AntiNuke } from "@repo/db";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class Trusted extends Command {
	public constructor() {
		super({
			name: "trusted",
			description: { content: "Manage users trusted by the security system", examples: ["trusted show", "trusted add @user"], usage: "trusted <show|add|remove|reset> [user]" },
			category: "security",
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: ["Administrator"] },
			options: [
				{ name: "show", description: "Show trusted users", type: ApplicationCommandOptionType.Subcommand },
				{
					name: "add", description: "Trust a user", type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to trust", type: ApplicationCommandOptionType.User, required: true }],
				},
				{
					name: "remove", description: "Remove a trusted user", type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to remove", type: ApplicationCommandOptionType.User, required: true }],
				},
				{ name: "reset", description: "Remove every trusted user", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const action = (ctx.options.getSubCommand(false, 0) ?? "show").toLowerCase();
		const settings = await AntiNuke.get(ctx.guild.id);
		const trusted = settings.trustedUsers ?? [];

		if (action === "show") {
			const names = await Promise.all(trusted.slice(0, 50).map(async ({ id }) => {
				const user = await ctx.client.users.fetch(id).catch(() => null);
				return `${user?.username ?? "Unknown user"} (\`${id}\`)`;
			}));
			return ctx.sendMessage({
				components: [createInfoPanel(ctx, "Trusted Users", "Security bypass list.", [
					["Total", trusted.length.toString()],
					["Users", names.length ? names.join("\n-# ") : "None configured"],
				])],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		if (action === "reset") {
			await AntiNuke.update(ctx.guild.id, { trustedUsers: [] });
			return ctx.sendMessage("Trusted users have been reset.");
		}

		const user = ctx.options.getUser("user", true, 1);
		if (!user || user.bot) return ctx.sendMessage("Choose a valid non-bot user.");
		if (action === "add") {
			if (trusted.some((entry) => entry.id === user.id)) return ctx.sendMessage(`${user.username} is already trusted.`);
			await AntiNuke.update(ctx.guild.id, { trustedUsers: [...trusted, { id: user.id }] });
			return ctx.sendMessage(`${user.username} is now trusted by the security system.`);
		}
		if (action === "remove") {
			if (!trusted.some((entry) => entry.id === user.id)) return ctx.sendMessage(`${user.username} is not trusted.`);
			await AntiNuke.update(ctx.guild.id, { trustedUsers: trusted.filter((entry) => entry.id !== user.id) });
			return ctx.sendMessage(`${user.username} was removed from trusted users.`);
		}
		return ctx.sendMessage("Use `trusted show`, `trusted add`, `trusted remove`, or `trusted reset`.");
	}
}
