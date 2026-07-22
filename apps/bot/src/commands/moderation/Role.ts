import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors, Role, PermissionFlagsBits, PermissionResolvable } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

const dangerPermissions: PermissionResolvable[] = [
	PermissionFlagsBits.Administrator,
	PermissionFlagsBits.ManageGuild,
	PermissionFlagsBits.ManageRoles,
	PermissionFlagsBits.ManageChannels,
	PermissionFlagsBits.BanMembers,
	PermissionFlagsBits.KickMembers,
	PermissionFlagsBits.ManageMessages,
	PermissionFlagsBits.MentionEveryone,
	PermissionFlagsBits.ManageWebhooks,
];

export default class GiveRole extends Command {
	constructor() {
		super({
			name: "role",
			description: {
				content: "Add a role to a member",
				examples: ["role @user @role", "role 123456789012345678 987654321098765432"],
				usage: "role <user> <role>",
			},
			category: "moderation",
			aliases: ["addrole", "ar"],
			cooldown: 5,
			args: true,
			permissions: {
				dev: false,
				client: ["ManageRoles", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ManageRoles"],
			},
			slashCommand: true,
			options: [
				{
					name: "user",
					description: "The member to give the role to",
					type: ApplicationCommandOptionType.User,
					required: true,
				},
				{
					name: "role",
					description: "The role to give",
					type: ApplicationCommandOptionType.Role,
					required: true,
				},
			],
		});
	}

	 private hasDangerousPermissions(role: Role): boolean {
			return dangerPermissions.some(perm => role.permissions.has(perm));
		}
	public async run(ctx: Context): Promise<any> {
		const target = ctx.options.getMember("user", 0) as GuildMember;
		const role = ctx.options.getRole("role", true, 1) as Role;

		if (!target) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("Member not found");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		if (!role) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("Role not found");
			return await ctx.sendMessage({ embeds: [embed] });
		}
		if (this.hasDangerousPermissions(role) && ctx.author?.id !== ctx.guild.ownerId) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("You cannot give a role with dangerous permissions");
			return await ctx.sendMessage({ embeds: [embed] });
		}
		// Permission checks
		if (role.position >= ctx.guild.members.me!.roles.highest.position) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("I cannot assign a role higher than my highest role");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		if (role.position >= (ctx.member?.roles.highest.position ?? 0)) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("You cannot assign a role higher than your highest role");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		if (target.roles.cache.has(role.id)) {
			// remove role
			try {
				await target.roles.remove(role, `Removed by ${ctx.author?.tag}`);
				const embed = new EmbedBuilder()
					.setColor(Colors.Green)
					.setTitle("<:Tick:1375519268292264012> Role Removed")
					.setDescription(
						`**Member:** ${target.toString()}\n` +
						`**Role:** ${role.toString()}\n` +
						`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
					);

				return await ctx.sendMessage({ embeds: [embed] });
			} catch (error) {
				console.error("RemoveRole Error:", error);
				const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Failed to remove role");
				await ctx.sendMessage({ embeds: [embed] });
			}
		}

		try {
			await target.roles.add(role, `Added by ${ctx.author?.tag}`);

			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle("<:Tick:1375519268292264012> Role Added")
				.setDescription(
					`**Member:** ${target.toString()}\n` +
					`**Role:** ${role.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
				);

			await ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("GiveRole Error:", error);
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Failed to add role");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
