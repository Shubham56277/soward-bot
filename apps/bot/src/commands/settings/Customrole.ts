import { CustomRole } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { dangerPermissions } from "../../utils/helper";
import { EmbedBuilder, Role } from "discord.js";
import { Pagination } from "../../utils/Pagination";

export default class CustomroleCommand extends Command {
	constructor() {
		super({
			name: "customrole",
			description: {
				content: "Manage custom roles",
				examples: ["add <alias> <role>", "remove <role>", "manager <role>", "list", "reset"],
				usage: "customrole <subcommand>",
			},
			category: "settings",
			aliases: ["cr"],
			cooldown: 5,
			args: true,
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
					name: "manger",
					description: "Manager the custom roles",
					type: 1,
					options: [
						{
							name: "role",
							description: "The role to add for the manger",
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
	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand();

		if (subcommand === "add") {
			const alias = ctx.options.getString("alias", true, 1);
			if (!alias) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "Please specify an alias! `/customrole add <alias> <role>`",
						},
					],
				});
			}
			if (ctx.client.aliases.has(alias)) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "You cannot use this alias!",
						},
					],
				});
			}
			const commands = ctx.client.commands || ctx.client.aliases;
			if (commands.has(alias.toLowerCase())) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "Please use a different alias! this is a command name!",
						},
					],
				});
			}

			const role = ctx.options.getRole("role", true, 2);
			if (!role) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "Please specify a role! `/customrole add <alias> <role>`",
						},
					],
				});
			}
			if (role instanceof Role && role.permissions.has(dangerPermissions)) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: `This role has dangerous permissions! \`${dangerPermissions.join("`, `")}\``,
						},
					],
				});
			}

			if (role.position > (ctx.guild.members.me?.roles.highest.position ?? 0)) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "I cannot manage this role as it is higher than my highest role",
						},
					],
				});
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole && customRole.roles) {
				if (customRole.roles.some((r) => r.role === role.id) || customRole.roles.some((r) => r.aliase === alias)) {
					return ctx.editOrReply({
						embeds: [
							{
								color: ctx.client.config.colors.red,
								description: "This role or alias already exists!",
							},
						],
					});
				}

				customRole.roles.push({ role: role.id, aliase: alias });
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.main,
							description: `Added role ${role} with alias ${alias}`,
						},
					],
				});
			}
			await CustomRole.create({
				guildId: ctx.guild.id,
				roles: [{ role: role.id, aliase: alias }],
			});
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.main,
						description: `Added role ${role} with alias ${alias}`,
					},
				],
			});
		}
		if (subcommand === "remove") {
			const role = ctx.options.getRole("role", true, 1);
			if (!role) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "Please specify a role! `/customrole remove <role>`",
						},
					],
				});
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole && customRole.roles) {
				if (!customRole.roles.some((r) => r.role === role.id)) {
					return ctx.editOrReply({
						embeds: [
							{
								color: ctx.client.config.colors.red,
								description: "This role does not exist!",
							},
						],
					});
				}
				customRole.roles = customRole.roles.filter((r) => r.role !== role.id);
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.main,
							description: `Removed role ${role}`,
						},
					],
				});
			}
		}
		if (subcommand === "manger") {
			const role = ctx.options.getRole("role", true, 1);
			if (!role) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "Please specify a role! `/customrole manger <role>`",
						},
					],
				});
			}
			const customRole = await CustomRole.get(ctx.guild.id);
			if (customRole) {
				customRole.managerRole = role.id;
				await CustomRole.update(ctx.guild.id, customRole);
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.main,
							description: `Set manager role to ${role}`,
						},
					],
				});
			}
		}
		if (subcommand === "reset") {
			await CustomRole.delete(ctx.guild.id);
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.main,
						description: "Reset custom roles",
					},
				],
			});
		}
		if (subcommand === "list") {
			const customRole = await CustomRole.get(ctx.guild.id);
			if (!customRole) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "No custom roles",
						},
					],
				});
			}

			if (customRole.roles?.length === 0) {
				return ctx.editOrReply({
					embeds: [
						{
							color: ctx.client.config.colors.red,
							description: "No custom roles",
						},
					],
				});
			}
			const embeds: EmbedBuilder[] = [];
			for (let i = 0; i < customRole.roles!.length; i += 10) {
				const pageRoles = customRole.roles!.slice(i, i + 10);
				const em = new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setTitle("Custom Roles")
					.setDescription(pageRoles.map((r) => `\`${r.aliase}\`: <@&${r.role}>`).join("\n"))
					.setFooter({ text: `Total: ${customRole.roles!.length} roles` });
				embeds.push(em);
			}
			const pagination = new Pagination(ctx, embeds);
			await pagination.start();
		}
	}
}
