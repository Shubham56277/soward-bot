import { CustomRole } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { dangerPermissions } from "../../utils/helper";
import { ContainerBuilder, MessageFlags, Role, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import { ContainerPagination } from "../../utils/Pagination";
import Help from "../utils/Help";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class CustomroleCommand extends Command {
	constructor() {
		super({
			name: "customrole",
			description: {
				content: "Manage custom roles",
				examples: ["customrole add staff @Staff", "customrole remove @Staff", "customrole manager @Moderator", "customrole list", "customrole reset"],
				usage: "customrole <subcommand>",
			},
			category: "settings",
			aliases: ["cr"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [
				{
					name: "add",
					description: "Add a custom role",
					type: 1,
					options: [
						{
							name: "alias",
							description: "The alias of the role",
							type: 3,
							required: true,
						},
						{
							name: "role",
							description: "The role to add",
							type: 8,
							required: true,
						},
					],
				},
				{
					name: "remove",
					description: "Remove a custom role",
					type: 1,
					options: [
						{
							name: "role",
							description: "The role to remove",
							type: 8,
							required: true,
						},
					],
				},
				{
					name: "manager",
					description: "Set the manager role for custom roles",
					type: 1,
					options: [
						{
							name: "role",
							description: "The role to add for the manager",
							type: 8,
							required: true,
						},
					],
				},
				{
					name: "list",
					description: "List all custom roles",
					type: 1,
				},
				{
					name: "reset",
					description: "Reset all custom roles",
					type: 1,
				},
			],
		});
	}
	private msg(text: string): any {
		return {
			components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
			flags: MessageFlags.IsComponentsV2,
		};
	}

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand(false, 0);

		if (!subcommand) return new Help().showCommand(ctx, "customrole");

		if (subcommand === "add") {
			const alias = ctx.options.getString("alias", true, 1);
			if (!alias) {
				return ctx.editOrReply(this.msg("Please specify an alias! `/customrole add <alias> <role>`"));
			}
			if (ctx.client.aliases.has(alias)) {
				return ctx.editOrReply(this.msg("You cannot use this alias!"));
			}
			const commands = ctx.client.commands || ctx.client.aliases;
			if (commands.has(alias.toLowerCase())) {
				return ctx.editOrReply(this.msg("Please use a different alias! this is a command name!"));
			}

			const role = ctx.options.getRole("role", true, 2);
			if (!role) {
				return ctx.editOrReply(this.msg("Please specify a role! `/customrole add <alias> <role>`"));
			}
			if (role instanceof Role && role.permissions.has(dangerPermissions)) {
				return ctx.editOrReply(this.msg(`This role has dangerous permissions! \`${dangerPermissions.join("`, `")}\``));
			}

			if (role.position > (ctx.guild.members.me?.roles.highest.position ?? 0)) {
				return ctx.editOrReply(this.msg("I cannot manage this role as it is higher than my highest role"));
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole && customRole.roles) {
				if (customRole.roles.some((r) => r.role === role.id) || customRole.roles.some((r) => r.aliase === alias)) {
					return ctx.editOrReply(this.msg("This role or alias already exists!"));
				}

				customRole.roles.push({ role: role.id, aliase: alias });
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply(this.msg(`Added role ${role} with alias ${alias}`));
			}
			await CustomRole.create({
				guildId: ctx.guild.id,
				roles: [{ role: role.id, aliase: alias }],
			});
			return ctx.editOrReply(this.msg(`Added role ${role} with alias ${alias}`));
		}
		if (subcommand === "remove") {
			const role = ctx.options.getRole("role", true, 1);
			if (!role) {
				return ctx.editOrReply(this.msg("Please specify a role! `/customrole remove <role>`"));
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole && customRole.roles) {
				if (!customRole.roles.some((r) => r.role === role.id)) {
					return ctx.editOrReply(this.msg("This role does not exist!"));
				}
				customRole.roles = customRole.roles.filter((r) => r.role !== role.id);
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply(this.msg(`Removed role ${role}`));
			}
		}
		if (subcommand === "manager") {
			const role = ctx.options.getRole("role", true, 1);
			if (!role) {
				return ctx.editOrReply(this.msg("Please specify a role! `/customrole manager <role>`"));
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole) {
				customRole.managerRole = role.id;
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply(this.msg(`Set manager role to ${role}`));
			}
		}
		if (subcommand === "reset") {
			await CustomRole.delete(ctx.guild.id);
			return ctx.editOrReply(this.msg("Reset custom roles"));
		}
		if (subcommand === "list") {
			const customRole = await CustomRole.get(ctx.guild.id);
			if (!customRole) {
				return ctx.editOrReply(this.msg("No custom roles"));
			}

			if (customRole.roles?.length === 0) {
				return ctx.editOrReply(this.msg("No custom roles"));
			}
			const pages: ContainerBuilder[] = [];
			for (let i = 0; i < customRole.roles!.length; i += 10) {
				const pageRoles = customRole.roles!.slice(i, i + 10);
				const pg = Math.floor(i / 10) + 1;
				const totalPages = Math.ceil(customRole.roles!.length / 10);
				pages.push(buildPanel("Custom Roles",
					pageRoles.map((r) => `\`${r.aliase}\`: <@&${r.role}>`).join("\n")
					+ `\n\n-# Total: ${customRole.roles!.length} roles | Page ${pg}/${totalPages}`
				));
			}
			const pagination = new ContainerPagination(ctx, pages);
			await pagination.start();
		}
	}
}
