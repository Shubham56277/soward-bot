import { EmbedBuilder, Colors, ChatInputCommandInteraction, ApplicationCommandOptionType, PermissionFlagsBits, PermissionResolvable, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AutoRole } from "@repo/db";

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

export default class AutoroleCommand extends Command {
	constructor() {
		super({
			name: "autorole",
			description: {
				content: "Configure automatic role assignment for new members and bots",
				usage: "autorole <add|remove|clear|list> [role] [bot]",
				examples: ["autorole add @Member", "autorole add @BotRole bot", "autorole remove 123456789", "autorole clear", "autorole list"],
			},
			category: "welcome",
			aliases: ["auto-role"],
			cooldown: 5,
			args: true,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "ManageRoles"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [
				{
					name: "add",
					description: "Add a role to be automatically assigned",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "role",
							description: "The role to add",
							type: ApplicationCommandOptionType.Role,
							required: true,
						},
						{
							name: "type",
							description: "Type of auto role",
							type: ApplicationCommandOptionType.String,
							required: true,
							choices: [
								{ name: "For regular members", value: "member" },
								{ name: "For bots", value: "bot" },
							],
						},
					],
				},
				{
					name: "remove",
					description: "Remove a role from automatic assignment",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "role",
							description: "The ID of the auto role entry to remove",
							type: ApplicationCommandOptionType.Role,
							required: true,
						},
					],
				},
				{
					name: "clear",
					description: "Clear all automatically assigned roles",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "type",
							description: "Type of auto roles to clear",
							type: ApplicationCommandOptionType.String,
							required: false,
							choices: [
								{ name: "Regular members", value: "member" },
								{ name: "Bots", value: "bot" },
								{ name: "All types", value: "all" },
							],
						},
					],
				},
				{
					name: "list",
					description: "List all automatically assigned roles",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "type",
							description: "Type of auto roles to list",
							type: ApplicationCommandOptionType.String,
							required: false,
							choices: [
								{ name: "Regular members", value: "member" },
								{ name: "Bots", value: "bot" },
								{ name: "All types", value: "all" },
							],
						},
					],
				},
				{
					name: "toggle",
					description: "Enable or disable the auto role system",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "type",
							description: "Type of auto role to toggle",
							type: ApplicationCommandOptionType.String,
							required: true,
							choices: [
								{ name: "Regular members", value: "member" },
								{ name: "Bots", value: "bot" },
							],
						},
						{
							name: "state",
							description: "Enable or disable",
							type: ApplicationCommandOptionType.Boolean,
							required: true,
						},
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!ctx.guild) return;

		const subcommand = ctx.isInteraction ? (ctx.interaction as ChatInputCommandInteraction).options.getSubcommand() : ctx.args[0]?.toLowerCase();

		switch (subcommand) {
			case "add":
				return this.handleAdd(ctx);
			case "remove":
				return this.handleRemove(ctx);
			case "clear":
				return this.handleClear(ctx);
			case "list":
				return this.handleList(ctx);
			case "toggle":
				return this.handleToggle(ctx);
			default:
				return this.showHelp(ctx);
		}
	}
	private hasDangerousPermissions(role: Role): boolean {
		return dangerPermissions.some(perm => role.permissions.has(perm));
	}
	private async handleAdd(ctx: Context) {
		if (!ctx.guild || !ctx.author) return;

		const role = ctx.options.getRole("role", true, 1) as Role;

		const type = ctx.options.getString("type", true, 2);

		if (!role) {
			return this.sendError(ctx, "Role not found");
		}
		if (this.hasDangerousPermissions(role)) {
			return this.sendError(ctx, "This role has dangerous permissions");
		}
		if (role.position >= (ctx.guild.members.me?.roles.highest.position || 0)) {
			return this.sendError(ctx, "I can't assign roles higher than my highest role");
		}

		try {
			// Check if this role is already configured
			const existingRoles = await AutoRole.getForGuild(ctx.guild.id);
			const existingConfig = existingRoles.find((r) => r.roleId === role.id && r.isBot === (type === "bot"));

			if (existingConfig) {
				return this.sendError(ctx, `This role is already configured for ${type === "bot" ? "bots" : "members"}`);
			}

			const autoRole = await AutoRole.create({
				guildId: ctx.guild.id,
				roleId: role.id,
				isBot: type === "bot",
				enabled: true,
			});

			if (!autoRole) {
				return this.sendError(ctx, "Failed to create auto role configuration");
			}

			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setDescription(`<:Tick:1375519268292264012> Added ${role.toString()} as auto role for ${type === "bot" ? "bots" : "members"}`)
				.setFooter({ text: `Configuration ID: ${autoRole.id}` });

			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("AutoRole Add Error:", error);
			return this.sendError(ctx, "Failed to add auto role");
		}
	}

	private async handleRemove(ctx: Context) {
		if (!ctx.guild) return;

		const roleId = ctx.options.getRole("role", true, 1);

		if (!roleId) {
			return this.sendError(ctx, "Please provide a configuration ID");
		}

		try {
			const configs = await AutoRole.getForGuild(ctx.guild.id);
			const config = configs.find((c) => c.id === roleId.id);
			if (!config || config.guildId !== ctx.guild.id) {
				return this.sendError(ctx, "Auto role configuration not found");
			}

			const role = await ctx.guild.roles.fetch(config.roleId).catch(() => null);
			const roleName = role?.toString() || `Unknown Role (${config.roleId})`;

			await AutoRole.delete(config.id);

			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setDescription(`<:Tick:1375519268292264012> Removed auto role configuration for ${roleName}`)
				.setFooter({ text: `Was for: ${config.isBot ? "bots" : "members"}` });

			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("AutoRole Remove Error:", error);
			return this.sendError(ctx, "Failed to remove auto role");
		}
	}

	private async handleClear(ctx: Context) {
		if (!ctx.guild) return;

		const type = ctx.options.getString("type", false, 1);

		if (type !== "all" && type !== "bot" && type !== "member") {
			return this.sendError(ctx, "Please provide a valid type");
		}

		try {
			const allConfigs = await AutoRole.getForGuild(ctx.guild.id);

			if (allConfigs.length === 0) {
				return this.sendError(ctx, "There are no auto roles configured");
			}

			let configsToDelete = allConfigs;
			let description = "<:Tick:1375519268292264012> Cleared all auto roles";

			if (type !== "all") {
				const isBot = type === "bot";
				configsToDelete = allConfigs.filter((c) => c.isBot === isBot);
				description = `<:Tick:1375519268292264012> Cleared all auto roles for ${type === "bot" ? "bots" : "members"}`;

				if (configsToDelete.length === 0) {
					return this.sendError(ctx, `There are no auto roles configured for ${type === "bot" ? "bots" : "members"}`);
				}
			}

			if (type === "all") {
				await AutoRole.deleteAllForGuild(ctx.guild.id);
			} else {
				await Promise.all(configsToDelete.map((c) => AutoRole.delete(c.id)));
			}

			const embed = new EmbedBuilder().setColor(Colors.Green).setDescription(description);

			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("AutoRole Clear Error:", error);
			return this.sendError(ctx, "Failed to clear auto roles");
		}
	}

	private async handleList(ctx: Context) {
		if (!ctx.guild) return;

		const type = ctx.options.getString("type", false, 1);

		if (type !== "all" && type !== "bot" && type !== "member") {
			return this.sendError(ctx, "Please provide a valid type");
		}

		try {
			const allConfigs = await AutoRole.getForGuild(ctx.guild.id);

			if (allConfigs.length === 0) {
				return ctx.sendMessage({
					embeds: [new EmbedBuilder().setColor(Colors.Blue).setDescription("No auto roles are currently configured")],
				});
			}

			let configsToShow = allConfigs;
			let title = "All Auto Roles";

			if (type !== "all") {
				const isBot = type === "bot";
				configsToShow = allConfigs.filter((c) => c.isBot === isBot);
				title = `Auto Roles for ${type === "bot" ? "Bots" : "Members"}`;

				if (configsToShow.length === 0) {
					return ctx.sendMessage({
						embeds: [new EmbedBuilder().setColor(Colors.Blue).setDescription(`No auto roles configured for ${type === "bot" ? "bots" : "members"}`)],
					});
				}
			}

			const rolesList = await Promise.all(
				configsToShow.map(async (config) => {
					const role = await ctx.guild!.roles.fetch(config.roleId).catch(() => null);
					const roleName = role?.toString() || `Unknown Role (${config.roleId})`;
					return `• ${roleName}\n` + `  **Type:** ${config.isBot ? "Bot" : "Member"}\n` + `  **Status:** ${config.enabled ? "<:Tick:1375519268292264012> Enabled" : "<:Cross:1375519752746958858> Disabled"}\n` + `  **Config ID:** \`${config.id}\``;
				}),
			);

			const embed = new EmbedBuilder()
				.setColor(Colors.Blue)
				.setTitle(title)
				.setDescription(rolesList.join("\n\n"))
				.setFooter({ text: `Total: ${configsToShow.length}` });

			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("AutoRole List Error:", error);
			return this.sendError(ctx, "Failed to list auto roles");
		}
	}

	private async handleToggle(ctx: Context) {
		if (!ctx.guild) return;

		const type = ctx.options.getString("type", true, 1) || "member";

		const state = ctx.options.getBoolean("state", true, 2);

		try {
			const allConfigs = await AutoRole.getForGuild(ctx.guild.id);
			const isBot = type === "bot";
			const configsToUpdate = allConfigs.filter((c) => c.isBot === isBot);

			if (configsToUpdate.length === 0) {
				return this.sendError(ctx, `No auto roles configured for ${type === "bot" ? "bots" : "members"}`);
			}

			await Promise.all(configsToUpdate.map((c) => AutoRole.update(c.id, { enabled: state })));

			const embed = new EmbedBuilder().setColor(state ? Colors.Green : Colors.Red).setDescription(`<:Tick:1375519268292264012> Auto roles for ${type === "bot" ? "bots" : "members"} are now ${state ? "enabled" : "disabled"}`);

			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("AutoRole Toggle Error:", error);
			return this.sendError(ctx, "Failed to toggle auto roles");
		}
	}

	private async showHelp(ctx: Context) {
		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("AutoRole Command Help")
			.setDescription(
				"**Configure automatic role assignment for new members and bots**\n\n" +
				"**Subcommands:**\n" +
				"`/autorole add <role> <type>` - Add a role to auto assign\n" +
				"`/autorole remove <role_id>` - Remove an auto role configuration\n" +
				"`/autorole clear [type]` - Clear auto roles (specify type or all)\n" +
				"`/autorole list [type]` - List auto roles (specify type or all)\n" +
				"`/autorole toggle <type> <state>` - Enable/disable auto roles for a type\n\n" +
				"**Types:** `member` (regular users) or `bot`",
			);

		return ctx.sendMessage({ embeds: [embed] });
	}

	private async sendError(ctx: Context, message: string) {
		return ctx.sendMessage({
			embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`<:Cross:1375519752746958858> ${message}`)],
		});
	}
}