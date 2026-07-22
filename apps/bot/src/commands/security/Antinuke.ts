import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	GuildMember,
	InteractionResponse,
	Message,
	MessageFlags,
	ModalBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { capitalize } from "../../utils/helper";
import { Pagination } from "../../utils/Pagination";
import { env } from "@repo/env";

const getGuildConfigKey = (g: string) => `c:${g}`;

export default class AntiNukeCommand extends Command {
	constructor() {
		super({
			name: "antinuke",
			description: {
				content: "Setup antinuke protection",
				examples: ["antinuke"],
				usage: "antinuke",
			},
			category: "security",
			aliases: ["antinuke"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Administrator"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [
				{
					name: "setup",
					description: "Setup antinuke protection",
					type: 1,
				},
				{
					name: "reset",
					description: "Reset antinuke protection",
					type: 1,
				},
				{
					name: "config",
					description: "Configure antinuke protection",
					type: 1,
				},
				{
					name: "disable",
					description: "Disable/Enable antinuke protection",
					type: 1,
				},
				{
					name: "whitelist",
					description: "Whitelist a channel from antinuke protection",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: "add",
							description: "Add a user to the whitelist",
							type: 1,
							options: [
								{
									name: "user",
									description: "The user to add to the whitelist",
									type: 6,
									required: true,
								},
							],
						},
						{
							name: "remove",
							description: "Remove a user from the whitelist",
							type: 1,
							options: [
								{
									name: "user",
									description: "The user to remove from the whitelist",
									type: 6,
									required: true,
								},
							],
						},
						{
							name: "list",
							description: "List all users in the whitelist",
							type: 1,
						},
						{
							name: "clear",
							description: "Clear the whitelist",
							type: 1,
						},
					],
				},
				{
					name: "admin",
					description: "Add or remove an admin",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: "add",
							description: "Add an admin",
							type: 1,
							options: [
								{
									name: "user",
									description: "The user to add as an admin",
									type: 6,
									required: true,
								},
							],
						},
						{
							name: "remove",
							description: "Remove an admin",
							type: 1,
							options: [
								{
									name: "user",
									description: "The user to remove as an admin",
									type: 6,
									required: true,
								},
							],
						},
						{
							name: "info",
							description: "info about the admin",
							type: 1,
						},
					],
				},
			],
		});
	}
	public async run(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id!);
		if (ctx.author?.id !== ctx.guild.ownerId && settings.admin !== ctx.author?.id && !env.DEVELOPER_IDS.includes(ctx.author?.id!)) {
			return ctx.editOrReply({
				content: "You must be the server owner to use this command.",
			});
		}
		const subCommandGroup = ctx.options.getSubcommandGroup() || ctx.options.getSubCommand();

		if (subCommandGroup === "setup") {
			return this.setup(ctx, settings);
		}
		if (subCommandGroup === "reset") {
			return this.reset(ctx, settings);
		}
		if (subCommandGroup === "config") {
			return this.config(ctx, settings);
		}
		if (subCommandGroup === "disable") {
			return this.disable(ctx, settings);
		}
		if (subCommandGroup === "whitelist") {
			const subCommand = ctx.options.getSubCommand(true, 1);
			if (subCommand === "add") {
				const user = ctx.options.getMember("user", 2) as GuildMember;
				return this.whitelistAdd(ctx, settings, user);
			}
			if (subCommand === "remove") {
				const user = ctx.options.getMember("user", 2) as GuildMember;
				return this.whitelistRemove(ctx, settings, user);
			}
			if (subCommand === "list") {
				return this.whitelistList(ctx, settings);
			}
			if (subCommand === "clear") {
				return this.whitelistClear(ctx, settings);
			}
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Please select a subcommand",
						description: [
							"Available subcommands:",
							"-# `/antinuke whitelist add` - Add a user to the whitelist",
							"-# `/antinuke whitelist remove` - Remove a user from the whitelist",
							"-# `/antinuke whitelist list` - List all users in the whitelist",
							"-# `/antinuke whitelist clear` - Clear the whitelist",
							"",
							"Use `/help antinuke` for more information.",
						].join("\n"),
					},
				],
			});
		}
		if (subCommandGroup === "admin") {
			const subCommand = ctx.options.getSubCommand(true, 1);
			if (subCommand === "add") {
				const user = ctx.options.getMember("user", 2) as GuildMember;
				return this.adminAdd(ctx, user);
			}
			if (subCommand === "remove") {
				const user = ctx.options.getMember("user", 2) as GuildMember;
				return this.adminRemove(ctx, user);
			}
			if (subCommand === "info") {
				return this.adminInfo(ctx, settings);
			}
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Please select a subcommand",
						description: [
							"Available subcommands:",
							"-# `/antinuke admin add` - Add an admin",
							"-# `/antinuke admin remove` - Remove an admin",
							"-# `/antinuke admin info` - Info about the admin",
							"",
							"Use `/help antinuke` for more information.",
						].join("\n"),
					},
				],
			});
		}
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.red,
					title: "Please select a subcommand",
					description: [
						"Available subcommands:",
						"-# `/antinuke setup` - Enable protection",
						"-# `/antinuke config` - Configure settings",
						"-# `/antinuke disable` - Turn off/on protection",
						"-# `/antinuke reset` - Restore defaults",
						"-# `/antinuke whitelist` - Manage the whitelist",
						"-# `/antinuke admin` - Manage admins",
						"",
						"Use `/help antinuke` for more information.",
					].join("\n"),
				},
			],
		});
	}
	private async setup(ctx: Context, settings: AntiNuke) {
		if (settings && settings.enabled) {
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						description: "AntiNuke is already enabled in this server.",
					},
				],
			});
		}

		const botMember = await ctx.guild.members.fetch(ctx.client.user!.id);
		let role = ctx.guild.roles.cache.find((r) => r.name === "Soward Supreme");

		if (!role) {
			role = await ctx.guild.roles
				.create({
					name: "Soward Supreme",
					color: ctx.client.config.colors.main,
					permissions: ["Administrator"],
					position: botMember.roles.highest.position,
					reason: "AntiNuke setup",
				})
				.catch(() => undefined);

			if (!role) throw new Error("Failed to create role");
		}

		await botMember.roles.add(role.id).catch(() => { });

		const config: any = { enabled: true, mention: true, gateKeeper: true };
		const DEFAULT_CONFIG = {
			channel: ["create", "delete", "update"],
			member: ["kick", "ban", "unban", "update"],
			emoji: ["create", "delete", "update"],
			role: ["create", "delete", "update"],
			webhook: ["create", "delete", "update"],
			sticker: ["create", "delete", "update"],
			guild: ["update"],
		};

		for (const [category, types] of Object.entries(DEFAULT_CONFIG)) {
			config[category] = types.map((type) => ({
				type,
				enabled: true,
				limit: 1,
				action: "ban",
			}));
		}

		settings = await AntiNuke.update(ctx.guild.id!, config);
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(settings));
		return await ctx.editOrReply({
			embeds: [
				new EmbedBuilder()
					.setTitle("AntiNuke Setup Complete")
					.setDescription(
						[
							"Your server is now protected with AntiNuke security!",
							"",
							`**Important:** Please drag the <@&${role.id}> role to the top of the role hierarchy.`,
							"",
							`${settings.channel?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Channel**: ${settings.channel.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.member?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Member**: ${settings.member.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.emoji?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Emoji**: ${settings.emoji.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.role?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Role**: ${settings.role.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.webhook?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Webhook**: ${settings.webhook.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.sticker?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Sticker**: ${settings.sticker.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.guild?.length ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Guild**: ${settings.guild.map((c) => `\`${c.type}\``).join(", ") || "None"}`,
							`${settings.mention ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Mention**: for preventing mentions of this server`,
							`${settings.gateKeeper ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **GateKeeper**: for protecting against (bot)`,
							"",
							"-# To reset AntiNuke, use `/antinuke reset`.",
							"-# To configure AntiNuke, use `/antinuke config`.",
							"-# To disable AntiNuke, use `/antinuke disable`.",
						].join("\n"),
					)
					.setColor(ctx.client.config.colors.main)
					.setFooter({ text: "Protection active" })
					.setTimestamp(),
			],
		});
	}
	private async reset(ctx: Context, settings: AntiNuke) {
		const getGuildConfigKey = (guildId: string) => `antinuke:config:${guildId}`;
		const getUserActionsKey = (guildId: string, userId: string) => `antinuke:${guildId}:${userId}:actions`;

		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						description: "This server is not protected with AntiNuke.",
					},
				],
			});

		await AntiNuke.delete(ctx.guild.id!);
		ctx.client.redis.del(getGuildConfigKey(ctx.guild.id!));
		ctx.client.redis.del(getUserActionsKey(ctx.guild.id!, ctx.author?.id!));

		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					description: "AntiNuke has been reset.",
				},
			],
		});
	}

	private async disable(ctx: Context, settings: AntiNuke) {

		if (!settings.enabled) {
			const config = await AntiNuke.update(ctx.guild.id!, { enabled: true });
			const cacheKey = getGuildConfigKey(ctx.guild.id!);
			
			await ctx.client.redis.set(cacheKey, JSON.stringify(config));
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.main,
						description: "AntiNuke has been enabled.",
					},
				],
			});
		}
		const config = await AntiNuke.update(ctx.guild.id!, { enabled: false });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey, JSON.stringify(
			config
		));

		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					description: "AntiNuke has been disabled.",
				},
			],
		});
	}

	private async whitelistAdd(ctx: Context, settings: AntiNuke, user: GuildMember) {
		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "AntiNuke Disabled",
						description: "AntiNuke protection is not enabled for this server.",
					},
				],
			});

		if (!user)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing User",
						description: "Please specify a user to add to the whitelist.",
					},
				],
			});

		if (settings.trustedUsers.some((u) => u.id === user.id))
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Already Whitelisted",
						description: `${user.user.username} is already on the whitelist.`,
					},
				],
			});

		const config = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [...settings.trustedUsers, { id: user.id }] });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(config));
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "Whitelist Updated",
					description: `${user.user.username} has been added to the whitelist.`,
				},
			],
		});
	}

	private async whitelistRemove(ctx: Context, settings: AntiNuke, user: GuildMember) {
		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "AntiNuke Disabled",
						description: "AntiNuke protection is not enabled for this server.",
					},
				],
			});

		if (!user)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing User",
						description: "Please specify a user to remove from the whitelist.",
					},
				],
			});

		if (!settings.trustedUsers.some((u) => u.id === user.id))
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Not Whitelisted",
						description: `${user.user.username} is not on the whitelist.`,
					},
				],
			});

		const config = await AntiNuke.update(ctx.guild.id!, { trustedUsers: settings.trustedUsers.filter((u) => u.id !== user.id) });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(config));
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "Whitelist Updated",
					description: `${user.user.username} has been removed from the whitelist.`,
				},
			],
		});
	}

	private async whitelistList(ctx: Context, settings: AntiNuke) {
		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "AntiNuke Disabled",
						description: "AntiNuke protection is not enabled for this server.",
					},
				],
			});

		const users = settings.trustedUsers;

		const usersPerPage = 10;
		const embedPages: EmbedBuilder[] = [];

		for (let i = 0; i < users.length; i += usersPerPage) {
			const pageUsers = users.slice(i, i + usersPerPage);

			const embed = new EmbedBuilder()
				.setColor(ctx.client.config.colors.main)
				.setTitle("Whitelisted Users")
				.setDescription(pageUsers.map((user) => `<@${user.id}> (\`${user.id}\`)`).join("\n"))
				.setFooter({ text: `Total: ${users.length} users` });

			embedPages.push(embed);
		}

		const pagination = new Pagination(ctx, embedPages);
		await pagination.start();
	}

	private async whitelistClear(ctx: Context, settings: AntiNuke) {
		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "AntiNuke Disabled",
						description: "AntiNuke protection is not enabled for this server.",
					},
				],
			});

		const config = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [] });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(config));
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "Whitelist Cleared",
					description: "All users have been removed from the whitelist.",
				},
			],
		});
	}
	private async adminAdd(ctx: Context, user: GuildMember) {
		if (ctx.author?.id !== ctx.guild.ownerId && !env.DEVELOPER_IDS.includes(ctx.author?.id!))
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing Permissions",
						description: "You do not have permission to use this command.",
					},
				],
			});
		if (!user)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing User",
						description: "Please specify a user to add to the admin list.",
					},
				],
			});

		const config = await AntiNuke.update(ctx.guild.id!, { admin: user.id });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(config));
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "Admin Added",
					description: `${user.user.username} has been added to the admin list.`,
				},
			],
		});
	}
	private async adminRemove(ctx: Context, user: GuildMember) {
		if (ctx.author?.id !== ctx.guild.ownerId && !env.DEVELOPER_IDS.includes(ctx.author?.id!))
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing Permissions",
						description: "You do not have permission to use this command.",
					},
				],
			});
		if (!user)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Missing User",
						description: "Please specify a user to remove from the admin list.",
					},
				],
			});

		const config = await AntiNuke.update(ctx.guild.id!, { admin: null });
		const cacheKey = getGuildConfigKey(ctx.guild.id!);

		await ctx.client.redis.set(cacheKey,  JSON.stringify(config));
		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "Admin Removed",
					description: `${user.user.username} has been removed from the admin list.`,
				},
			],
		});
	}
	private async adminInfo(ctx: Context, settings: AntiNuke) {
		if (!settings.enabled)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "AntiNuke Disabled",
						description: "AntiNuke protection is not enabled for this server.",
					},
				],
			});

		if (!settings.admin)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Admin Not Found",
						description: "The admin user could not be found.",
					},
				],
			});

		const user = ctx.guild.members.cache.get(settings.admin);

		if (!user)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						title: "Admin Not Found",
						description: "The admin user could not be found.",
					},
				],
			});

		const createdAt = user?.user.createdAt ? formatDate(user.user.createdAt) : "Unknown";
		const joinedAt = user?.joinedAt ? formatDate(user.joinedAt) : "Unknown";

		return ctx.editOrReply({
			embeds: [
				{
					color: ctx.client.config.colors.main,
					title: "AntiNuke Admin Information",
					fields: [
						{
							name: "Admin User",
							value: user ? `${user.user.username} (${user.user.toString()})` : "Not set",
							inline: true,
						},
						{
							name: "User ID",
							value: user?.id || "Not available",
							inline: true,
						},
						{
							name: "Account Created",
							value: createdAt,
							inline: true,
						},
						{
							name: "Joined Server",
							value: joinedAt,
							inline: true,
						},
						{
							name: "Permissions",
							value: user?.permissions.toArray().join(", ") || "No special permissions",
							inline: false,
						},
					],
					thumbnail: {
						url: user?.user.displayAvatarURL({ size: 4096 }) || "",
					},
					footer: {
						text: `AntiNuke Protection • ${settings.enabled ? "Enabled" : "Disabled"}`,
					},
					timestamp: new Date().toISOString(),
				},
			],
		});
	}
	private async config(ctx: Context, settings: AntiNuke) {
		// Check if AntiNuke is disabled for this server
		if (!settings)
			return ctx.editOrReply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						description: "**AntiNuke Protection Disabled**\nThis server is not currently protected by AntiNuke.\n\nTo enable protection, use `/antinuke setup` to configure the system.",
						footer: { text: "AntiNuke helps prevent malicious actions like mass deletions or bans" },
					},
				],
			});

		// Helper function to create consistent buttons
		const createButton = (id: string, label: string, style = ButtonStyle.Secondary, emoji?: string) => {
			const button = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
			if (emoji) button.setEmoji(emoji);
			return button;
		};

		// Navigation buttons
		const edit = createButton("antinuke-config-edit", "Edit Settings", ButtonStyle.Primary);
		const home = createButton("antinuke-config-home", "Main Menu", ButtonStyle.Secondary);
		const back = createButton("antinuke-config-back", "Go Back", ButtonStyle.Secondary);

		// Main configuration menu with all protection modules
		const mainMenu = new StringSelectMenuBuilder()
			.setCustomId("antinuke-config")
			.setPlaceholder("Select a protection module to configure")
			.addOptions([
				{ label: "Channel Protection", value: "channel", description: "Prevent mass channel deletion/creation" },
				{ label: "Member Protection", value: "member", description: "Prevent mass kicks/bans" },
				{ label: "Emoji Protection", value: "emoji", description: "Prevent emoji spam/deletion" },
				{ label: "Role Protection", value: "role", description: "Prevent role manipulation" },
				{ label: "Webhook Protection", value: "webhook", description: "Prevent webhook spam" },
				{ label: "Sticker Protection", value: "sticker", description: "Prevent sticker spam" },
				{ label: "Server Protection", value: "guild", description: "Prevent server setting changes" },
				{ label: "Mention Protection", value: "mention", description: "Prevent mass mentions" },
				{ label: "Gatekeeper", value: "gateKeeper", description: "Bot/user verification system" },
			]);

		// Helper to create status lines with emoji indicators
		const createStatusLine = (value: any[], name: string) => {
			const enabled = value?.length > 0;
			const types = value?.map((c) => `\`${c.type}\``).join(", ") || "Not configured";
			const description = enabled
				? `${ctx.client.config.emojis.on} **${capitalize(name)} Protection**: ${types} (Active)`
				: `${ctx.client.config.emojis.off} **${capitalize(name)} Protection**: ${types} (Disabled)`;

			return `${description}`;
		};

		// Main embed showing all protection statuses
		const mainEmbed = new EmbedBuilder()
			.setTitle(`**AntiNuke Configuration - ${ctx.guild.name}**`)
			.setDescription(
				[
					"**AntiNuke protects your server from malicious actions and mass changes.**",
					"Use the menu below to configure specific protection modules.",
					"",
					`**Server ID**: \`${ctx.guild.id}\``,
					`**Protection Status**: ${settings?.enabled ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
					"",
					"**Enabled Protections:**",
					createStatusLine(settings.channel, "Channel"),
					createStatusLine(settings.member, "Member"),
					createStatusLine(settings.emoji, "Emoji"),
					createStatusLine(settings.role, "Role"),
					createStatusLine(settings.webhook, "Webhook"),
					createStatusLine(settings.sticker, "Sticker"),
					createStatusLine(settings.guild, "Server"),
					`${settings.mention ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **Mention Protection**: Prevents mass mentions in this server`,
					`${settings.gateKeeper ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} **GateKeeper**: ${settings.gateKeeper ? "Active (Bot Join)" : "Disabled"}`,
					"",
					"**How to configure:**",
					"1. Select a module from the dropdown",
					"2. Choose specific protection types",
					"3. Adjust limits and actions as needed",
					"",
					"-# **Note:** All changes are saved automatically",
				].join("\n"),
			)
			.setColor(ctx.client.config.colors.main)
			.setFooter({ text: "AntiNuke will automatically take action when thresholds are exceeded" });

		// Send the initial configuration message
		const msg = await ctx.editOrReply({
			embeds: [mainEmbed],
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu)],
		});

		// Filter to ensure only the command author can interact
		const filter = (i: any) => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						description: "**Access Denied**\nOnly the command author can configure AntiNuke.",
						footer: { text: "Ask a server administrator for assistance" },
					},
				],
				flags: MessageFlags.Ephemeral,
			});
			return false;
		};

		// Function to create main menu collector
		const createMainCollector = (message: Message | InteractionResponse) => {
			const collector = message.createMessageComponentCollector({
				componentType: ComponentType.StringSelect,
				time: 150000, // 2.5 minutes timeout
				filter,
			});

			// Handle main menu selections
			collector.on("collect", async (int) => {
				const module = int.values[0];
				if (!module) return;

				switch (module) {
					case "channel":
						return handleModule(int, "channel", settings.channel, "AntiNukeChannel");
					case "member":
						return handleModule(int, "member", settings.member, "AntiNukeMember");
					case "emoji":
						return handleModule(int, "emoji", settings.emoji, "AntiNukeEmoji");
					case "role":
						return handleModule(int, "role", settings.role, "AntiNukeRole");
					case "sticker":
						return handleModule(int, "sticker", settings.sticker, "AntiNukeSticker");
					case "webhook":
						return handleModule(int, "webhook", settings.webhook, "AntiNukeWebhook");
					case "guild":
						return handleModule(int, "guild", settings.guild, "AntiNukeGuild");
					case "mention": {
						settings.mention = !settings.mention;
						settings = await AntiNuke.update(ctx.guild.id!, settings);
						const cacheKey = getGuildConfigKey(ctx.guild.id!);

						await ctx.client.redis.set(cacheKey,  JSON.stringify(settings));
						await int.update({
							embeds: [
								mainEmbed.setFooter({
									text: `Mention protection ${settings.mention ? "enabled" : "disabled"}`,
								}),
							],
							components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu)],
						});
						break;
					}
					case "gateKeeper": {
						settings.gateKeeper = !settings.gateKeeper;
						settings = await AntiNuke.update(ctx.guild.id!, settings);
						const cacheKey = getGuildConfigKey(ctx.guild.id!);

						await ctx.client.redis.set(cacheKey,  JSON.stringify(settings));
						await int.update({
							embeds: [
								mainEmbed.setFooter({
									text: `GateKeeper ${settings.gateKeeper ? "enabled" : "disabled"}`,
								}),
							],
							components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu)],
						});
						break;
					}
				}
			});

			collector.on("end", async (results, reason) => {
				if (reason === "time") {
					await message
						?.edit({
							components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu.setDisabled(true))],
						})
						.catch(() => { });
				}
			});

			return collector;
		};

		// Create initial main collector
		let mainCollector = createMainCollector(msg);

		// Handle module selection and configuration
		const handleModule = async (init: StringSelectMenuInteraction, module: string, options: any[], type: string) => {
			// Stop the main collector before creating new ones
			mainCollector.stop("Validation");
			const moduleName = capitalize(module);

			// Create embed showing all options for this module
			const moduleEmbed = new EmbedBuilder()
				.setTitle(`${moduleName} Protection Settings`)
				.setColor(ctx.client.config.colors.main)
				.setDescription(`Configure how AntiNuke protects against ${moduleName} abuse.\n**Current Settings:**`)
				.setFields(
					options.map((o) => ({
						name: `${o.enabled ? ctx.client.config.emojis.on : ctx.client.config.emojis.off} ${capitalize(o.type)} Protection`,
						value: [`-# **Threshold**: ${o.limit} actions`, `-# **Response**: ${o.action}`, `-# **Status**: ${o.enabled ? "Active" : "Disabled"}`].join("\n"),
						inline: true,
					})),
				)
				.setFooter({ text: `Select an option below to modify ${moduleName} protection` });

			// Create menu for specific module options
			const moduleMenu = new StringSelectMenuBuilder()
				.setCustomId(`antinuke-config-${module}-select`)
				.setPlaceholder(`Select ${moduleName} protection type`)
				.addOptions(
					options.map((o) => ({
						label: `${o.enabled ? "<:Tick:1375519268292264012>" : "<:Cross:1375519752746958858>"} ${capitalize(o.type)}`,
						value: o.type,
						description: `Limit: ${o.limit} | Action: ${o.action}`,
					})),
				);

			// Update message with module-specific view
			const msg = await init.update({
				embeds: [moduleEmbed],
				components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(moduleMenu)],
			});

			const handleOptionCollection = msg.createMessageComponentCollector({
				componentType: ComponentType.StringSelect,
				time: 150000,
				filter,
			});

			// Handle selection of specific protection type
			const handleOption = async (i: StringSelectMenuInteraction) => {
				const option = i.values[0];
				if (!option || !options.find((o) => o.type === option)) return;
				const optionData = options.find((o) => o.type === option);

				// Create action buttons
				const enabled = createButton("antinuke-config-toggle", optionData?.enabled ? "Disable Protection" : "Enable Protection", optionData?.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(enabled, edit, home, back);

				// Create detailed view for selected option
				const optionEmbed = new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription(
						[
							`## ${moduleName} ${capitalize(optionData?.type!)} Protection Settings`,
							"",
							`**${moduleName} ${capitalize(optionData?.type!)} Protection** is currently ${optionData?.enabled ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
							"",
							"**Current Configuration:**",
							`- **Threshold**: ${optionData?.limit} actions`,
							`- **Response Action**: ${optionData?.action}`,
							"",
							"**What this does:**",
							`When someone performs ${optionData?.limit} ${moduleName} ${optionData?.type} actions within a short time, `,
							`AntiNuke will automatically ${optionData?.action} the user.`,
						].join("\n"),
					)
					.setFooter({ text: "Use the buttons below to modify these settings" });

				const msg2 = await i.update({ embeds: [optionEmbed], components: [row] });

				// Stop previous collectors
				handleOptionCollection.resetTimer();

				const handleButtonCollection = msg2.createMessageComponentCollector({
					componentType: ComponentType.Button,
					time: 150000,
					filter,
				});

				// Handle button interactions for the option
				handleButtonCollection.on("collect", async (i: ButtonInteraction) => {
					if (i.customId === "antinuke-config-toggle") {
						// Toggle protection on/off
						optionData!.enabled = !optionData!.enabled;
						(settings as any)[module].find((o: any) => o.type === option)!.enabled = optionData!.enabled;
						settings = await AntiNuke.update(ctx.guild.id!, settings);
						const cacheKey = getGuildConfigKey(ctx.guild.id!);

						await ctx.client.redis.set(cacheKey,  JSON.stringify(settings));
						// Update message with new status
						const newEmbed = optionEmbed.setDescription(
							(optionEmbed.data.description ?? "").replace(
								optionData?.enabled ? ctx.client.config.emojis.off : ctx.client.config.emojis.on,
								optionData?.enabled ? ctx.client.config.emojis.on : ctx.client.config.emojis.off,
							),
						);

						await i.update({ embeds: [newEmbed], components: [row] });
					} else if (i.customId === "antinuke-config-edit") {
						// Show modal to edit limits and actions
						const modal = new ModalBuilder()
							.setCustomId("antinuke-config-edit-modal")
							.setTitle(`Edit ${capitalize(option)} Protection`)
							.addComponents(
								new ActionRowBuilder<TextInputBuilder>().addComponents(
									new TextInputBuilder()
										.setCustomId("antinuke-config-edit-limit")
										.setLabel("Action Threshold")
										.setPlaceholder("How many actions before triggering")
										.setValue(`${optionData?.limit || 0}`)
										.setRequired(true)
										.setStyle(TextInputStyle.Short)
										.setMinLength(1)
										.setMaxLength(2),
								),
								new ActionRowBuilder<TextInputBuilder>().addComponents(
									new TextInputBuilder()
										.setCustomId("antinuke-config-edit-action")
										.setLabel("Response Action")
										.setPlaceholder("kick, ban, or role-remove")
										.setValue(`${optionData?.action || "kick"}`)
										.setRequired(true)
										.setStyle(TextInputStyle.Short),
								),
							);

						await i.showModal(modal);

						// Handle modal submission
						await i
							.awaitModalSubmit({ time: 15000, filter })
							.then(async (m) => {
								const limit = Number(m.fields.getTextInputValue("antinuke-config-edit-limit") || 0);
								const action = m.fields.getTextInputValue("antinuke-config-edit-action").toLowerCase();

								if (!["kick", "ban", "role-remove"].includes(action)) {
									return m.reply({
										content: "⚠️ Invalid action. Must be one of: kick, ban, role-remove",
										flags: MessageFlags.Ephemeral,
									});
								}

								if (limit < 1 || limit > 50) {
									return m.reply({
										content: "⚠️ Threshold must be between 1 and 50",
										flags: MessageFlags.Ephemeral,
									});
								}

								// Update settings
								(settings as any)[module].find((o: any) => o.type === optionData!.type)!.limit = limit;
								(settings as any)[module].find((o: any) => o.type === optionData!.type)!.action = action;
								settings = await AntiNuke.update(ctx.guild.id!, settings);
								const cacheKey = getGuildConfigKey(ctx.guild.id!);

								await ctx.client.redis.set(cacheKey,  JSON.stringify(settings));
								// Update message with new values
								const updatedEmbed = new EmbedBuilder(optionEmbed.data).setDescription(
									[
										`**${capitalize(optionData?.type!)} Protection** is currently ${optionData?.enabled ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
										"",
										"**Updated Configuration:**",
										`- **Threshold**: ${limit} actions`,
										`- **Response Action**: ${action}`,
										"",
										"**What this does:**",
										`When someone performs ${limit} ${optionData?.type} actions within a short time, `,
										`AntiNuke will automatically ${action} the user.`,
									].join("\n"),
								);

								await m.deferUpdate();
								await msg2.edit({ embeds: [updatedEmbed] });
							})
							.catch(() => { });
					} else if (i.customId === "antinuke-config-home") {
						// Return to main menu
						handleButtonCollection.resetTimer();
						await i.update({ embeds: [mainEmbed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu)] });
						mainCollector = createMainCollector(msg);
					} else if (i.customId === "antinuke-config-back") {
						// Return to module view
						handleButtonCollection.resetTimer();
						await i.update({ embeds: [moduleEmbed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(moduleMenu)] });
						handleOptionCollection.on("collect", handleOption);
					}
				});
			};

			handleOptionCollection.on("collect", handleOption);
		};
	}
}

function formatDate(date: Date): string {
	return `<t:${Math.floor(date.getTime() / 1000)}:F> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;
}
