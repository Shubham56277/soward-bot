import { ApplicationCommandOptionType, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Mute extends Command {
	public constructor() {
		super({
			name: "mute",
			description: { content: "Temporarily mute a server member", examples: ["mute @user 10"], usage: "mute <user> [minutes] [reason]" },
			category: "moderation",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "ModerateMembers"], user: ["ModerateMembers"] },
			options: [
				{ name: "user", description: "Member to mute", type: ApplicationCommandOptionType.User, required: true },
				{ name: "minutes", description: "Duration in minutes", type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 40320 },
				{ name: "reason", description: "Reason for the mute", type: ApplicationCommandOptionType.String, required: false, max_length: 500 },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const member = ctx.options.getMember("user", 0) as GuildMember | null;
		if (!member) return ctx.sendMessage("Choose a valid server member.");
		if (member.id === ctx.author?.id) return ctx.sendMessage("You cannot mute yourself.");
		if (member.id === ctx.guild.ownerId) return ctx.sendMessage("The server owner cannot be muted.");
		if (!member.moderatable) return ctx.sendMessage("I cannot mute that member because their role is above mine.");
		if (ctx.member instanceof GuildMember && ctx.author?.id !== ctx.guild.ownerId && member.roles.highest.position >= ctx.member.roles.highest.position) {
			return ctx.sendMessage("You cannot mute a member with an equal or higher role.");
		}
		const minutes = ctx.options.getInteger("minutes", false, 1) ?? 10;
		const reason = ctx.options.getString("reason", false, 2) ?? `Muted by ${ctx.author?.username ?? "a moderator"}`;
		await member.timeout(minutes * 60_000, reason);
		return ctx.sendMessage(`${member.user.username} was muted for **${minutes} minute${minutes === 1 ? "" : "s"}**.`);
	}
}
