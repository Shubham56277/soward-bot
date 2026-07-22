import { ApplicationCommandOptionType, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Softban extends Command {
	public constructor() {
		super({
			name: "softban",
			description: { content: "Ban and immediately unban a user to clear recent messages", examples: ["softban @user spam"], usage: "softban <user> [reason]" },
			category: "moderation",
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "BanMembers"], user: ["BanMembers"] },
			options: [
				{ name: "user", description: "User to softban", type: ApplicationCommandOptionType.User, required: true },
				{ name: "reason", description: "Reason for the softban", type: ApplicationCommandOptionType.String, required: false, max_length: 500 },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", true, 0);
		if (!user) return ctx.sendMessage("Choose a valid user.");
		if (user.id === ctx.author?.id || user.id === ctx.guild.ownerId || user.id === ctx.client.user?.id) return ctx.sendMessage("That user cannot be softbanned.");
		const member = await ctx.guild.members.fetch(user.id).catch(() => null);
		if (member && !member.bannable) return ctx.sendMessage("I cannot softban that member because their role is above mine.");
		if (member && ctx.member instanceof GuildMember && ctx.author?.id !== ctx.guild.ownerId && member.roles.highest.position >= ctx.member.roles.highest.position) {
			return ctx.sendMessage("You cannot softban a member with an equal or higher role.");
		}
		const reason = ctx.options.getString("reason", false, 1) ?? `Softbanned by ${ctx.author?.username ?? "a moderator"}`;
		await ctx.guild.members.ban(user.id, { deleteMessageSeconds: 7 * 24 * 60 * 60, reason });
		await ctx.guild.bans.remove(user.id, "Softban completed");
		return ctx.sendMessage(`${user.username} was softbanned and can join again.`);
	}
}
