import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Nick extends Command {
	constructor() {
		super({
			name: "nick",
			description: {
				content: "Change a member's nickname",
				examples: ["nick @user NewNick", "nick 123456789012345678 Reset"],
				usage: "nick <user> [new nickname]",
			},
			category: "moderation",
			aliases: ["nickname", "setnick"],
			cooldown: 5,
			args: true,
			permissions: {
				dev: false,
				client: ["ManageNicknames", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ManageNicknames"],
			},
			slashCommand: false,
			options: [
				{
					name: "user",
					description: "The member to rename",
					type: ApplicationCommandOptionType.User,
					required: true,
				},
				{
					name: "nickname",
					description: "The new nickname (leave empty to reset)",
					type: ApplicationCommandOptionType.String,
					required: false,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const target = ctx.options.getMember("user") as GuildMember;
		let nickname = ctx.options.getString("nickname", false);

		// Handle text command
		if (!ctx.isInteraction) {
			const args = ctx.args;
			// If there are more arguments, they form the nickname
			if (args.length > 1) {
				nickname = args.slice(1).join(" ");
			} else {
				nickname = null; // Reset nickname when no nickname is provided
			}
		}

		if (!target) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("Member not found");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		if (ctx.author?.id !== ctx.guild.ownerId) {
			if (target.roles.highest.position >= (ctx.member?.roles.highest.position ?? 0)) {
				const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("You cannot modify someone with higher or equal role");
				return await ctx.sendMessage({ embeds: [embed] });
			}
		}

		if (ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("I cannot modify someone with higher or equal role");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		try {
			const oldNick = target.nickname || target.user.username;

			await target.setNickname(nickname || null, `Nickname changed by ${ctx.author?.tag}`);

			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle("<:Tick:1375519268292264012> Nickname Changed")
				.setDescription(
					`**Member:** ${target.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
					`**Before:** ${oldNick}\n` +
					`**After:** ${nickname || "Reset to default"}`
				);
			return await ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("Nick Error:", error);
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Failed to change nickname");
			return await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
