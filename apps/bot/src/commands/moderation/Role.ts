import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType, Role, PermissionFlagsBits, PermissionResolvable } from "discord.js";
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

function msg(text: string): any {
	return {
		components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
		flags: MessageFlags.IsComponentsV2,
	};
}

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
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> Member not found"));
		}

		if (!role) {
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> Role not found"));
		}

		if (this.hasDangerousPermissions(role) && ctx.author?.id !== ctx.guild.ownerId) {
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> You cannot give a role with dangerous permissions"));
		}

		// Permission checks
		if (role.position >= ctx.guild.members.me!.roles.highest.position) {
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> I cannot assign a role higher than my highest role"));
		}

		if (role.position >= (ctx.member?.roles.highest.position ?? 0)) {
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> You cannot assign a role higher than your highest role"));
		}

		if (target.roles.cache.has(role.id)) {
			// remove role
			try {
				await target.roles.remove(role, `Removed by ${ctx.author?.tag}`);

				const container = new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**<:Tick:1375519268292264012> Role Removed**`))
					.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(
						`**Member:** ${target.toString()}\n` +
						`**Role:** ${role.toString()}\n` +
						`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
					));

				return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
			} catch (error) {
				console.error("RemoveRole Error:", error);
				return await ctx.sendMessage(msg("<:Cross:1375519752746958858> Failed to remove role"));
			}
		}

		try {
			await target.roles.add(role, `Added by ${ctx.author?.tag}`);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**<:Tick:1375519268292264012> Role Added**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Member:** ${target.toString()}\n` +
					`**Role:** ${role.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
				));

			return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("GiveRole Error:", error);
			return await ctx.sendMessage(msg("<:Cross:1375519752746958858> Failed to add role"));
		}
	}
}
