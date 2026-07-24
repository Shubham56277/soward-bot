import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	GuildMember,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextDisplayBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { capitalize } from "../../utils/helper";
import { env } from "@repo/env";

// Cache key matches the existing pattern used in the rest of the bot
const getGuildConfigKey = (guildId: string) => `c:${guildId}`;

// Default module configuration applied on first enable
const DEFAULT_MODULE_CONFIG = {
	channel: ["create", "delete", "update"],
	member: ["kick", "ban", "unban", "update"],
	emoji: ["create", "delete", "update"],
	role: ["create", "delete", "update"],
	webhook: ["create", "delete", "update"],
	sticker: ["create", "delete", "update"],
	guild: ["update"],
} as const;

type ModuleKey = keyof typeof DEFAULT_MODULE_CONFIG;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a Components V2 container with a header, divider, and body text.
 */
function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/**
 * Send a plain Components V2 message via ctx.editOrReply.
 */
async function cv2Reply(ctx: Context, title: string, body: string): Promise<any> {
	return ctx.editOrReply({
		components: [buildPanel(title, body)],
		flags: MessageFlags.IsComponentsV2,
	});
}

// ─── Command ───────────────────────────────────────────────────────────────

export default class AntiNukeCommand extends Command {
	constructor() {
		super({
			name: "antinuke",
			description: {
				content: "Manage antinuke server protection",
				examples: ["antinuke enable", "antinuke config", "antinuke whitelist add @user"],
				usage: "antinuke <enable|disable|config|whitelist|punishment>",
			},
			category: "security",
			aliases: ["an"],
			cooldown: 5,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Administrator"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [
				{
					name: "enable",
					description: "Enable antinuke protection (creates Soward Supreme role)",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "disable",
					description: "Toggle antinuke protection on or off",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "config",
					description: "View and configure antinuke module settings",
					type: ApplicationCommandOptionType.Subcommand,
				},
			],
		});
	}

	// ── Access guard ──────────────────────────────────────────────────────

	private isAuthorized(ctx: Context, settings: AntiNuke): boolean {
		const userId = ctx.author?.id ?? "";
		return (
			userId === ctx.guild.ownerId ||
			userId === settings.admin ||
			env.DEVELOPER_IDS.includes(userId)
		);
	}

	// ── Entry point ───────────────────────────────────────────────────────

	public async run(ctx: Context): Promise<any> {
		try {
			const sub = (
				ctx.options.getSubCommand(false, 0) ?? ""
			).toLowerCase().trim();

			if (!sub) {
				return this.showHelp(ctx);
			}

			let settings: AntiNuke;
			try {
				settings = await AntiNuke.get(ctx.guild.id!);
			} catch {
				return cv2Reply(ctx, "AntiNuke — Error", "Could not load antinuke settings. Please try again.");
			}

			if (!this.isAuthorized(ctx, settings)) {
				return cv2Reply(
					ctx,
					"AntiNuke — Access Denied",
					"Only the server owner or a designated antinuke admin may use this command.",
				);
			}

			switch (sub) {
				case "enable":
					return this.enable(ctx, settings);
				case "disable":
					return this.disable(ctx, settings);
				case "config":
					return this.config(ctx, settings);
				case "punishment":
					return this.punishment(ctx, settings);
				case "whitelist": {
					const wsub = (ctx.args[1] ?? "").toLowerCase();
					switch (wsub) {
						case "add":    return this.whitelistAdd(ctx, settings);
						case "remove": return this.whitelistRemove(ctx, settings);
						case "list":   return this.whitelistList(ctx, settings);
						case "clear":  return this.whitelistClear(ctx, settings);
						default:       return this.whitelistHelp(ctx);
					}
				}
				default:
					return this.showHelp(ctx);
			}
		} catch {
			return cv2Reply(ctx, "AntiNuke — Unexpected Error", "An unexpected error occurred. Please try again.");
		}
	}

	// ── Help panel ────────────────────────────────────────────────────────

	private async showHelp(ctx: Context): Promise<any> {
		try {
			const body = [
				"AntiNuke protects your server from destructive actions.",
				"",
				"Subcommands",
				"───────────────────────────────",
				"  ?antinuke enable",
				"    Enable protection and create the Soward Supreme role.",
				"",
				"  ?antinuke disable",
				"    Toggle protection on or off.",
				"",
				"  ?antinuke config",
				"    View and adjust module settings via interactive menus.",
				"",
				"  ?antinuke punishment <ban|kick|rolestrip>",
				"    Set the default punishment applied across all modules.",
				"",
				"  ?antinuke whitelist add <@user>",
				"  ?antinuke whitelist remove <@user>",
				"  ?antinuke whitelist list",
				"  ?antinuke whitelist clear",
				"    Manage users who are exempt from antinuke checks.",
				"",
				"Slash equivalents: /antinuke enable  /antinuke disable  /antinuke config",
			].join("\n");

			return ctx.editOrReply({
				components: [buildPanel("AntiNuke — Help", body)],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Could not display help. Please try again.");
		}
	}

	private async whitelistHelp(ctx: Context): Promise<any> {
		const body = [
			"Usage: ?antinuke whitelist <add|remove|list|clear>",
			"",
			"  add @user    — Exempt a user from antinuke checks.",
			"  remove @user — Remove a user from the exemption list.",
			"  list         — Show all exempted users.",
			"  clear        — Remove all exemptions.",
		].join("\n");
		return cv2Reply(ctx, "AntiNuke — Whitelist Help", body);
	}

	// ── Enable ────────────────────────────────────────────────────────────

	private async enable(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (settings?.enabled) {
				return cv2Reply(
					ctx,
					"AntiNuke — Already Enabled",
					"Protection is already active on this server.\nUse `?antinuke config` to adjust module settings.",
				);
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
						reason: "AntiNuke enable",
					})
					.catch(() => undefined);

				if (!role) {
					return cv2Reply(ctx, "AntiNuke — Setup Failed", "Could not create the Soward Supreme role. Please check bot permissions.");
				}
			}

			await botMember.roles.add(role.id).catch(() => {});

			const config: Record<string, any> = { enabled: true, mention: true, gateKeeper: true };
			for (const [category, types] of Object.entries(DEFAULT_MODULE_CONFIG)) {
				config[category] = (types as readonly string[]).map((type) => ({
					type,
					enabled: true,
					limit: 1,
					action: "ban",
				}));
			}

			const saved = await AntiNuke.update(ctx.guild.id!, config);
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(saved));

			const moduleLines = (Object.keys(DEFAULT_MODULE_CONFIG) as ModuleKey[])
				.map((cat) => `  ${capitalize(cat)}: ${DEFAULT_MODULE_CONFIG[cat].join(", ")}`)
				.join("\n");

			const body = [
				"Protection is now enabled.",
				"",
				"Important: drag the Soward Supreme role to the top of the role list.",
				"",
				"Default modules enabled",
				"───────────────────────────────",
				moduleLines,
				"  Mention protection: on",
				"  GateKeeper: on",
				"",
				"Default punishment: ban",
				"Use `?antinuke config` to customise modules.",
			].join("\n");

			return cv2Reply(ctx, "AntiNuke — Protection Enabled", body);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to enable antinuke. Please try again.");
		}
	}

	// ── Disable (toggle) ──────────────────────────────────────────────────

	private async disable(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			const nowEnabled = !settings.enabled;
			const updated = await AntiNuke.update(ctx.guild.id!, { enabled: nowEnabled });
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(updated));

			const detail = nowEnabled
				? "Antinuke protection is now active."
				: "Antinuke protection has been turned off. Use `?antinuke enable` to re-enable.";

			return cv2Reply(ctx, `AntiNuke — Protection ${nowEnabled ? "Enabled" : "Disabled"}`, detail);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to toggle antinuke. Please try again.");
		}
	}

	// ── Punishment ────────────────────────────────────────────────────────

	private async punishment(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings.enabled) {
				return cv2Reply(ctx, "AntiNuke — Not Enabled", "Enable antinuke first with `?antinuke enable`.");
			}

			const validPunishments = ["ban", "kick", "rolestrip"] as const;
			type Punishment = typeof validPunishments[number];
			const value = ((ctx.args[1] ?? "") as string).toLowerCase() as Punishment;

			if (!(validPunishments as readonly string[]).includes(value)) {
				return cv2Reply(
					ctx,
					"AntiNuke — Punishment",
					[
						"Usage: ?antinuke punishment <ban|kick|rolestrip>",
						"",
						"  ban       — Permanently ban the offender.",
						"  kick      — Kick the offender from the server.",
						"  rolestrip — Remove all roles from the offender.",
					].join("\n"),
				);
			}

			const patch: Record<string, any> = {};
			for (const cat of Object.keys(DEFAULT_MODULE_CONFIG) as ModuleKey[]) {
				const entries: any[] = (settings as any)[cat] ?? [];
				if (entries.length) {
					patch[cat] = entries.map((e: any) => ({ ...e, action: value }));
				}
			}

			const updated = await AntiNuke.update(ctx.guild.id!, patch);
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(updated));

			return cv2Reply(
				ctx,
				"AntiNuke — Punishment Updated",
				`Default punishment set to: ${value}\n\nThis applies to all protection modules.`,
			);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to update punishment. Please try again.");
		}
	}

	// ── Whitelist ─────────────────────────────────────────────────────────

	private async whitelistAdd(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings.enabled) {
				return cv2Reply(ctx, "AntiNuke — Not Enabled", "Enable antinuke first with `?antinuke enable`.");
			}

			const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
			if (!member) {
				return cv2Reply(ctx, "AntiNuke — Missing User", "Mention a user: `?antinuke whitelist add @user`");
			}

			if (settings.trustedUsers.some((u) => u.id === member.id)) {
				return cv2Reply(ctx, "AntiNuke — Already Whitelisted", `${member.user.username} is already on the whitelist.`);
			}

			const updated = await AntiNuke.update(ctx.guild.id!, {
				trustedUsers: [...settings.trustedUsers, { id: member.id }],
			});
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(updated));

			return cv2Reply(ctx, "AntiNuke — Whitelist Updated", `${member.user.username} has been added to the whitelist.`);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to update whitelist. Please try again.");
		}
	}

	private async whitelistRemove(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings.enabled) {
				return cv2Reply(ctx, "AntiNuke — Not Enabled", "Enable antinuke first with `?antinuke enable`.");
			}

			const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
			if (!member) {
				return cv2Reply(ctx, "AntiNuke — Missing User", "Mention a user: `?antinuke whitelist remove @user`");
			}

			if (!settings.trustedUsers.some((u) => u.id === member.id)) {
				return cv2Reply(ctx, "AntiNuke — Not Whitelisted", `${member.user.username} is not on the whitelist.`);
			}

			const updated = await AntiNuke.update(ctx.guild.id!, {
				trustedUsers: settings.trustedUsers.filter((u) => u.id !== member.id),
			});
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(updated));

			return cv2Reply(ctx, "AntiNuke — Whitelist Updated", `${member.user.username} has been removed from the whitelist.`);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to update whitelist. Please try again.");
		}
	}

	private async whitelistList(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings.enabled) {
				return cv2Reply(ctx, "AntiNuke — Not Enabled", "Enable antinuke first with `?antinuke enable`.");
			}

			const users = settings.trustedUsers;
			if (!users.length) {
				return cv2Reply(ctx, "AntiNuke — Whitelist", "The whitelist is empty. No users are currently exempt.");
			}

			const lines = users.map((u) => `  <@${u.id}> (${u.id})`).join("\n");
			return cv2Reply(ctx, "AntiNuke — Whitelist", `Total: ${users.length} user${users.length !== 1 ? "s" : ""}\n\n${lines}`);
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to retrieve whitelist. Please try again.");
		}
	}

	private async whitelistClear(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings.enabled) {
				return cv2Reply(ctx, "AntiNuke — Not Enabled", "Enable antinuke first with `?antinuke enable`.");
			}

			const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [] });
			await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(updated));

			return cv2Reply(ctx, "AntiNuke — Whitelist Cleared", "All users have been removed from the whitelist.");
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to clear whitelist. Please try again.");
		}
	}

	// ── Config ────────────────────────────────────────────────────────────

	private async config(ctx: Context, settings: AntiNuke): Promise<any> {
		try {
			if (!settings?.enabled) {
				return cv2Reply(
					ctx,
					"AntiNuke — Not Enabled",
					"Enable antinuke first with `?antinuke enable` before configuring modules.",
				);
			}

			const overviewLines = (Object.keys(DEFAULT_MODULE_CONFIG) as ModuleKey[]).map((cat) => {
				const entries: any[] = (settings as any)[cat] ?? [];
				const activeTypes = entries.filter((e) => e.enabled).map((e) => e.type);
				const status = activeTypes.length ? activeTypes.join(", ") : "all disabled";
				return `  ${capitalize(cat)}: ${status}`;
			});

			overviewLines.push(`  Mention: ${settings.mention ? "on" : "off"}`);
			overviewLines.push(`  GateKeeper: ${settings.gateKeeper ? "on" : "off"}`);

			const overviewText = [
				`Protection is currently ${settings.enabled ? "enabled" : "disabled"}.`,
				"",
				"───────────────────────────────",
				...overviewLines,
				"───────────────────────────────",
				"",
				"Use the menu below to configure a module.",
			].join("\n");

			const mainMenu = new StringSelectMenuBuilder()
				.setCustomId("an:config:module")
				.setPlaceholder("Select a module to configure")
				.addOptions([
					{ label: "Channel",    value: "channel",    description: "create, delete, update" },
					{ label: "Member",     value: "member",     description: "kick, ban, unban, update" },
					{ label: "Emoji",      value: "emoji",      description: "create, delete, update" },
					{ label: "Role",       value: "role",       description: "create, delete, update" },
					{ label: "Webhook",    value: "webhook",    description: "create, delete, update" },
					{ label: "Sticker",    value: "sticker",    description: "create, delete, update" },
					{ label: "Guild",      value: "guild",      description: "update" },
					{ label: "Mention",    value: "mention",    description: "Toggle mention protection" },
					{ label: "GateKeeper", value: "gateKeeper", description: "Toggle bot-join gatekeeper" },
				]);

			const mainRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu);
			const mainPanel = buildPanel("AntiNuke — Config", overviewText);

			const msg = await ctx.editOrReply({
				components: [mainPanel, mainRow],
				flags: MessageFlags.IsComponentsV2,
			});

			const filter = (i: any): boolean => {
				if (i.user.id === ctx.author?.id) return true;
				i.reply({
					components: [buildPanel("AntiNuke — Access Denied", "Only the command author may use these controls.")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				}).catch(() => {});
				return false;
			};

			const mainCollector = msg.createMessageComponentCollector({
				componentType: ComponentType.StringSelect,
				time: 120_000,
				filter,
			});

			mainCollector.on("collect", async (int: StringSelectMenuInteraction) => {
				try {
					const module = int.values[0];
					if (!module) return;

					if (module === "mention" || module === "gateKeeper") {
						(settings as any)[module] = !((settings as any)[module]);
						settings = await AntiNuke.update(ctx.guild.id!, settings);
						await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(settings));
						const newStatus = (settings as any)[module] ? "on" : "off";
						await int.update({
							components: [
								buildPanel("AntiNuke — Config", `${capitalize(module)} has been turned ${newStatus}.\n\nUse the menu to configure another module.`),
								mainRow,
							],
						}).catch(() => {});
						return;
					}

					return this.handleModuleConfig(int, module as ModuleKey, settings, ctx, mainRow, filter);
				} catch {
					await int.reply({
						components: [buildPanel("AntiNuke — Error", "An error occurred. Please try again.")],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					}).catch(() => {});
				}
			});

			mainCollector.on("end", (_c, reason) => {
				if (reason === "time") {
					msg.edit({ components: [mainPanel, mainRow] }).catch(() => {});
				}
			});
		} catch {
			return cv2Reply(ctx, "AntiNuke — Error", "Failed to open config. Please try again.");
		}
	}

	// ── Module config drill-down ──────────────────────────────────────────

	private async handleModuleConfig(
		int: StringSelectMenuInteraction,
		module: ModuleKey,
		settings: AntiNuke,
		ctx: Context,
		mainRow: ActionRowBuilder<StringSelectMenuBuilder>,
		filter: (i: any) => boolean,
	): Promise<void> {
		try {
			const entries: any[] = (settings as any)[module] ?? [];
			const moduleName = capitalize(module);

			const buildTypeButtons = (items: any[]): ActionRowBuilder<ButtonBuilder>[] => {
				const rows: ActionRowBuilder<ButtonBuilder>[] = [];
				for (let i = 0; i < items.length; i += 5) {
					const chunk = items.slice(i, i + 5);
					const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
						chunk.map((e: any) =>
							new ButtonBuilder()
								.setCustomId(`an:toggle:${module}:${e.type}`)
								.setLabel(`${capitalize(e.type)}: ${e.enabled ? "on" : "off"}`)
								.setStyle(e.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
						),
					);
					rows.push(row);
				}
				rows.push(
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId("an:back")
							.setLabel("Back to module list")
							.setStyle(ButtonStyle.Secondary),
					),
				);
				return rows;
			};

			const buildModulePanel = (items: any[]): ContainerBuilder => {
				const lines = items.map((e: any) =>
					`  ${capitalize(e.type)}: ${e.enabled ? "on" : "off"}  (limit: ${e.limit}, action: ${e.action})`
				);
				return buildPanel(
					`AntiNuke — ${moduleName} Module`,
					[
						`Configure ${moduleName} protection types.`,
						"",
						"───────────────────────────────",
						...lines,
						"───────────────────────────────",
						"",
						"Toggle each type using the buttons below.",
					].join("\n"),
				);
			};

			const modulePanel = buildModulePanel(entries);
			const typeButtons = buildTypeButtons(entries);

			await int.update({ components: [modulePanel, ...typeButtons] }).catch(() => {});

			const btnCollector = int.message.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: 90_000,
				filter,
			});

			btnCollector.on("collect", async (btn) => {
				try {
					if (btn.customId === "an:back") {
						btnCollector.stop("back");
						await btn.update({
							components: [buildPanel("AntiNuke — Config", "Use the menu to select a module."), mainRow],
						}).catch(() => {});
						return;
					}

					const parts = btn.customId.split(":");
					const targetModule = parts[2] as ModuleKey;
					const targetType = parts[3];
					if (!targetModule || !targetType) return;

					const moduleEntries: any[] = (settings as any)[targetModule] ?? [];
					const entry = moduleEntries.find((e: any) => e.type === targetType);
					if (!entry) return;

					entry.enabled = !entry.enabled;
					settings = await AntiNuke.update(ctx.guild.id!, settings);
					await ctx.client.redis.set(getGuildConfigKey(ctx.guild.id!), JSON.stringify(settings));

					const refreshedEntries: any[] = (settings as any)[targetModule] ?? [];
					const refreshedPanel = buildModulePanel(refreshedEntries);
					const refreshedButtons = buildTypeButtons(refreshedEntries);

					await btn.update({ components: [refreshedPanel, ...refreshedButtons] }).catch(() => {});
				} catch {
					await btn.reply({
						components: [buildPanel("AntiNuke — Error", "An error occurred. Please try again.")],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					}).catch(() => {});
				}
			});

			btnCollector.on("end", (_c, reason) => {
				if (reason === "time") {
					int.message
						.edit({ components: [buildPanel("AntiNuke — Config", "Session expired. Run the command again."), mainRow] })
						.catch(() => {});
				}
			});
		} catch {
			await int.reply({
				components: [buildPanel("AntiNuke — Error", "Failed to load module config. Please try again.")],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			}).catch(() => {});
		}
	}
}
