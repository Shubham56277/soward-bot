import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	GuildMember,
	MessageFlags,
	ModalBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { capitalize } from "../../utils/helper";
import { env } from "@repo/env";

// ─── Constants ─────────────────────────────────────────────────────────────

const CACHE_KEY = (guildId: string) => `c:${guildId}`;

const MODULES = {
	channel: { label: "Channel", description: "Channel create, delete, update", types: ["create", "delete", "update"] },
	role: { label: "Role", description: "Role create, delete, update", types: ["create", "delete", "update"] },
	member: { label: "Member", description: "Kick, ban, unban, update", types: ["kick", "ban", "unban", "update"] },
	emoji: { label: "Emoji", description: "Emoji create, delete, update", types: ["create", "delete", "update"] },
	webhook: { label: "Webhook", description: "Webhook create, delete, update", types: ["create", "delete", "update"] },
	sticker: { label: "Sticker", description: "Sticker create, delete, update", types: ["create", "delete", "update"] },
	guild: { label: "Server", description: "Server settings update", types: ["update"] },
} as const;

type ModuleKey = keyof typeof MODULES;
type Punishment = "ban" | "kick" | "rolestrip";

const PUNISHMENTS: Punishment[] = ["ban", "kick", "rolestrip"];

const EMOJI = {
	on: "◈",
	off: "◇",
	shield: "🛡",
	lock: "🔒",
	warn: "⚠",
	check: "✓",
	dot: "•",
} as const;

// ─── UI Builders ───────────────────────────────────────────────────────────

function panel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${EMOJI.shield} ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/** Emoji-free panel used by the paginated dashboard. */
function plainPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/** Aligned `label ... value` row using a fixed-width label column. */
function row(label: string, value: string): string {
	return `\`${label.padEnd(16)}\` ${value}`;
}

function reply(ctx: Context, title: string, body: string): Promise<any> {
	return ctx.editOrReply({ components: [panel(title, body)], flags: MessageFlags.IsComponentsV2 });
}

function statusBadge(enabled: boolean): string {
	return enabled ? `\`${EMOJI.on} ON\`` : `\`${EMOJI.off} OFF\``;
}

function moduleStatus(settings: AntiNuke): string {
	const lines: string[] = [];
	for (const [key, meta] of Object.entries(MODULES)) {
		const entries: any[] = (settings as any)[key] ?? [];
		const active = entries.filter((e: any) => e.enabled);
		const badge = active.length > 0 ? `${EMOJI.on}` : `${EMOJI.off}`;
		const detail = active.length > 0
			? active.map((e: any) => e.type).join(", ")
			: "disabled";
		lines.push(`${badge} **${meta.label}** — ${detail}`);
	}
	lines.push(`${settings.mention ? EMOJI.on : EMOJI.off} **Mention** — ${settings.mention ? "active" : "disabled"}`);
	lines.push(`${settings.gateKeeper ? EMOJI.on : EMOJI.off} **GateKeeper** — ${settings.gateKeeper ? "active" : "disabled"}`);
	return lines.join("\n");
}

// ─── Command ───────────────────────────────────────────────────────────────

export default class AntiNukeCommand extends Command {
	constructor() {
		super({
			name: "antinuke",
			description: {
				content: "Configure server protection against nukes and raids",
				examples: ["antinuke", "antinuke enable", "antinuke config", "antinuke whitelist add @user"],
				usage: "antinuke <enable|disable|config|punishment|whitelist|settings>",
			},
			category: "security",
			aliases: ["an", "antinuke"],
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
				{ name: "enable", description: "Enable antinuke protection", type: ApplicationCommandOptionType.Subcommand },
				{ name: "disable", description: "Disable antinuke protection", type: ApplicationCommandOptionType.Subcommand },
				{ name: "config", description: "Configure protection modules", type: ApplicationCommandOptionType.Subcommand },
				{ name: "settings", description: "View current protection status", type: ApplicationCommandOptionType.Subcommand },
				{
					name: "punishment",
					description: "Set default punishment for all modules",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{
						name: "action",
						description: "Punishment type",
						type: ApplicationCommandOptionType.String,
						required: true,
						choices: [
							{ name: "Ban", value: "ban" },
							{ name: "Kick", value: "kick" },
							{ name: "Role Strip", value: "rolestrip" },
						],
					}],
				},
				{
					name: "whitelist",
					description: "Manage exempt users",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: "add",
							description: "Add a user to the whitelist",
							type: ApplicationCommandOptionType.Subcommand,
							options: [{ name: "user", description: "User to whitelist", type: ApplicationCommandOptionType.User, required: true }],
						},
						{
							name: "remove",
							description: "Remove a user from the whitelist",
							type: ApplicationCommandOptionType.Subcommand,
							options: [{ name: "user", description: "User to remove", type: ApplicationCommandOptionType.User, required: true }],
						},
						{ name: "list", description: "Show all whitelisted users", type: ApplicationCommandOptionType.Subcommand },
						{ name: "reset", description: "Clear the entire whitelist", type: ApplicationCommandOptionType.Subcommand },
					],
				},
			],
		});
	}

	// ─── Authorization ────────────────────────────────────────────────────

	private async isAuthorized(ctx: Context, settings: AntiNuke): Promise<boolean> {
		const userId = ctx.author?.id ?? "";
		if (userId === ctx.guild.ownerId || userId === settings.admin || env.DEVELOPER_IDS.includes(userId)) return true;
		// Extra owners from the legacy trustedUsers field
		const trustedIds = settings.trustedUsers?.map(u => u.id) ?? [];
		if (trustedIds.includes(userId)) return true;
		// Extra owners from Redis-based extra owner system
		const raw = await ctx.client.redis.get(`extraowners:${ctx.guild.id}`).catch(() => null);
		if (raw) {
			try {
				const owners = JSON.parse(raw) as { userId: string }[];
				if (owners.some(o => o.userId === userId)) return true;
			} catch {}
		}
		return false;
	}

	// ─── Entry Point ──────────────────────────────────────────────────────

	public async run(ctx: Context): Promise<any> {
		try {
			const sub = (ctx.options.getSubCommand(false, 0) ?? "").toLowerCase().trim();
			const group = ctx.isInteraction ? (ctx.options.getSubcommandGroup?.() ?? "") : "";

			// No subcommand → show dashboard
			if (!sub && !group) return this.dashboard(ctx);

			let settings: AntiNuke;
			try {
				settings = await AntiNuke.get(ctx.guild.id!);
			} catch {
				return reply(ctx, "Error", "Could not load antinuke settings. Please try again.");
			}

			if (!(await this.isAuthorized(ctx, settings))) {
				return reply(ctx, "Access Denied", `${EMOJI.lock} Only the server owner or antinuke admin can use this command.`);
			}

			// Handle whitelist subcommand group
			if (group === "whitelist" || sub === "whitelist") {
				const wsub = group ? sub : (ctx.args[1] ?? "").toLowerCase();
				switch (wsub) {
					case "add": return this.whitelistAdd(ctx, settings);
					case "remove": return this.whitelistRemove(ctx, settings);
					case "list": return this.whitelistList(ctx, settings);
					case "reset": return this.whitelistReset(ctx, settings);
					default: return this.whitelistHelp(ctx);
				}
			}

			switch (sub) {
				case "enable": return this.enable(ctx, settings);
				case "disable": return this.disable(ctx, settings);
				case "config": return this.config(ctx, settings);
				case "settings": return this.dashboard(ctx);
				case "punishment": return this.punishment(ctx, settings);
				default: return this.dashboard(ctx);
			}
		} catch {
			return reply(ctx, "Error", "An unexpected error occurred. Please try again.");
		}
	}

	// ─── Dashboard ────────────────────────────────────────────────────────

	private async dashboard(ctx: Context): Promise<any> {
		let settings: AntiNuke;
		try {
			settings = await AntiNuke.get(ctx.guild.id!);
		} catch {
			return reply(ctx, "Error", "Could not load antinuke settings.");
		}

		const pages = [
			() => this.overviewPage(settings),
			() => this.modulesPage(settings),
			() => this.accessPage(),
		];

		let index = 0;
		const render = (disabled: boolean) => ({
			components: [plainPanel("AntiNuke", pages[index]!()), this.navRow(disabled)],
			flags: MessageFlags.IsComponentsV2,
		});

		const msg = await ctx.editOrReply(render(false));

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 120_000,
			filter: (i: any) => {
				if (i.user.id === ctx.author?.id) return true;
				i.reply({
					components: [plainPanel("Access Denied", "Only the command author can use these controls.")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				}).catch(() => {});
				return false;
			},
		});

		collector.on("collect", async (btn) => {
			try {
				switch (btn.customId) {
					case "antinuke_prev":
						index = (index - 1 + pages.length) % pages.length;
						break;
					case "antinuke_next":
						index = (index + 1) % pages.length;
						break;
					case "antinuke_home":
						index = 0;
						break;
					case "antinuke_close":
						collector.stop("closed");
						await btn.message.delete().catch(() => {});
						return;
					default:
						return;
				}
				await btn.update(render(false)).catch(() => {});
			} catch {
				// Ignore interaction failures (message deleted, expired token, etc.)
			}
		});

		collector.on("end", (_c, reason) => {
			if (reason === "time") msg.edit(render(true)).catch(() => {});
		});
	}

	// ─── Dashboard pages ──────────────────────────────────────────────────

	/** Page 1 — Overview */
	private overviewPage(settings: AntiNuke): string {
		const moduleKeys = Object.keys(MODULES) as ModuleKey[];
		const enabledModules = moduleKeys.filter((key) => {
			const entries: any[] = (settings as any)[key] ?? [];
			return entries.some((e: any) => e.enabled);
		}).length
			+ (settings.mention ? 1 : 0)
			+ (settings.gateKeeper ? 1 : 0);
		const totalModules = moduleKeys.length + 2;

		const listed = settings.trustedUsers?.length ?? 0;

		// Derive the configured punishment from the first module entry that has one.
		let punishment = "Not set";
		for (const key of moduleKeys) {
			const entry = ((settings as any)[key] ?? []).find((e: any) => e.action);
			if (entry) {
				punishment = capitalize(entry.action);
				break;
			}
		}

		return [
			"Real-time protection against destructive server actions.",
			"",
			"**Overview**",
			row("Protection", settings.enabled ? "Enabled" : "Disabled"),
			row("Modules", `${enabledModules} / ${totalModules}`),
			row("Whitelist", `${listed} ${listed === 1 ? "User" : "Users"}`),
			row("Punishment", punishment),
			"",
			"**Quick Commands**",
			"`?antinuke enable` — Enable protection",
			"`?antinuke config` — Configure protection",
			"`?antinuke disable` — Disable protection",
			"",
			"-# Page 1 of 3",
		].join("\n");
	}

	/** Page 2 — Protection Modules */
	private modulesPage(settings: AntiNuke): string {
		const lines = (Object.keys(MODULES) as ModuleKey[]).map((key) => {
			const entries: any[] = (settings as any)[key] ?? [];
			const active = entries.some((e: any) => e.enabled);
			return row(MODULES[key].label, active ? "Enabled" : "Disabled");
		});

		lines.push(row("Mention", settings.mention ? "Enabled" : "Disabled"));
		lines.push(row("GateKeeper", settings.gateKeeper ? "Enabled" : "Disabled"));

		return [
			"Review the protection modules currently active.",
			"",
			"**Protection Modules**",
			...lines,
			"",
			"**Quick Commands**",
			"`?antinuke config` — Configure modules",
			"`?antinuke punishment <action>` — Set punishment",
			"",
			"-# Page 2 of 3",
		].join("\n");
	}

	/** Page 3 — Access Management */
	private accessPage(): string {
		return [
			"Manage users excluded from automatic enforcement.",
			"",
			"**Whitelist**",
			"`?wl add @user` — Add with action panel",
			"`?wl remove @user` — Remove from whitelist",
			"`?wl list` — View whitelist",
			"`?wl reset` — Clear whitelist",
			"",
			"**Extra Owners**",
			"`?extraowner add @user` — Add an extra owner",
			"`?extraowner remove @user` — Remove an extra owner",
			"`?extraowner config @user` — Configure limits",
			"`?extraowner reset` — Clear all extra owners",
			"",
			"-# Page 3 of 3",
		].join("\n");
	}

	private navRow(disabled: boolean): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("antinuke_prev")
				.setLabel("◀")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(disabled),

			new ButtonBuilder()
				.setCustomId("antinuke_home")
				.setLabel("⌂")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(disabled),

			new ButtonBuilder()
				.setCustomId("antinuke_next")
				.setLabel("▶")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(disabled),

			new ButtonBuilder()
				.setCustomId("antinuke_close")
				.setLabel("🗑")
				.setStyle(ButtonStyle.Danger)
				.setDisabled(disabled),
		);
	}

	// ─── Enable ───────────────────────────────────────────────────────────

	private async enable(ctx: Context, settings: AntiNuke): Promise<any> {
		if (settings?.enabled) {
			return reply(ctx, "Already Active", `${EMOJI.check} Protection is already enabled.\nUse \`antinuke config\` to adjust modules.`);
		}

		const botMember = await ctx.guild.members.fetch(ctx.client.user!.id);
		let role = ctx.guild.roles.cache.find((r) => r.name === "Soward Supreme");

		if (!role) {
			role = await ctx.guild.roles.create({
				name: "Soward Supreme",
				color: ctx.client.config.colors.main,
				permissions: ["Administrator"],
				position: botMember.roles.highest.position,
				reason: "AntiNuke activation",
			}).catch(() => undefined);

			if (!role) {
				return reply(ctx, "Setup Failed", `${EMOJI.warn} Could not create the Soward Supreme role. Check bot permissions.`);
			}
		}

		await botMember.roles.add(role.id).catch(() => {});

		const config: Record<string, any> = { enabled: true, mention: true, gateKeeper: true };
		for (const [key, meta] of Object.entries(MODULES)) {
			config[key] = meta.types.map((type) => ({ type, enabled: true, limit: 1, action: "ban" }));
		}

		const saved = await AntiNuke.update(ctx.guild.id!, config);
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(saved));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);

		const moduleList = Object.values(MODULES).map((m) => `${EMOJI.on} ${m.label}`).join("\n");

		const body = [
			`${EMOJI.check} **Protection is now active.**`,
			"",
			`${EMOJI.warn} **Important:** Drag the \`Soward Supreme\` role to the top of your role list.`,
			"",
			"━━━━━━━━━━━━━━━━━━━━━━━",
			"**Enabled Modules**",
			"━━━━━━━━━━━━━━━━━━━━━━━",
			moduleList,
			`${EMOJI.on} Mention Protection`,
			`${EMOJI.on} GateKeeper`,
			"",
			"**Default Action:** `ban`",
			"",
			"-# Use `antinuke config` to customize individual modules.",
		].join("\n");

		return reply(ctx, "Protection Enabled", body);
	}

	// ─── Disable ──────────────────────────────────────────────────────────

	private async disable(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) {
			return reply(ctx, "Already Disabled", `${EMOJI.check} Protection is already disabled.\nUse \`antinuke enable\` to re-activate.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { enabled: false });
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);

		return reply(ctx, "Protection Disabled", `${EMOJI.warn} Protection has been **disabled**.\n\n-# Your configuration is preserved. Use \`antinuke enable\` to re-activate.`);
	}

	// ─── Punishment ───────────────────────────────────────────────────────

	private async punishment(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) {
			return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first with \`antinuke enable\`.`);
		}

		const value = (ctx.isInteraction
			? ctx.options.getString("action", true)
			: (ctx.args[1] ?? "")
		).toLowerCase() as Punishment;

		if (!PUNISHMENTS.includes(value)) {
			const body = [
				"**Set the default punishment for all modules.**",
				"",
				"Usage: `antinuke punishment <action>`",
				"",
				`${EMOJI.dot} \`ban\` — Permanently ban the offender`,
				`${EMOJI.dot} \`kick\` — Kick the offender`,
				`${EMOJI.dot} \`rolestrip\` — Remove all roles`,
			].join("\n");
			return reply(ctx, "Punishment", body);
		}

		const patch: Record<string, any> = {};
		for (const key of Object.keys(MODULES) as ModuleKey[]) {
			const entries: any[] = (settings as any)[key] ?? [];
			if (entries.length) {
				patch[key] = entries.map((e: any) => ({ ...e, action: value }));
			}
		}

		const updated = await AntiNuke.update(ctx.guild.id!, patch);
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);

		return reply(ctx, "Punishment Updated", `${EMOJI.check} Default action set to **${value}** across all modules.`);
	}

	// ─── Whitelist ────────────────────────────────────────────────────────

	private async whitelistHelp(ctx: Context): Promise<any> {
		const body = [
			"**Manage users exempt from antinuke checks.**",
			"",
			`${EMOJI.dot} \`antinuke whitelist add @user\``,
			`${EMOJI.dot} \`antinuke whitelist remove @user\``,
			`${EMOJI.dot} \`antinuke whitelist list\``,
			`${EMOJI.dot} \`antinuke whitelist reset\``,
		].join("\n");
		return reply(ctx, "Whitelist", body);
	}

	private async whitelistAdd(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first.`);

		const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
		if (!member) return reply(ctx, "Missing User", "Mention a user or bot: `antinuke whitelist add @user`");
		if (settings.trustedUsers.some((u) => u.id === member.id)) {
			return reply(ctx, "Already Whitelisted", `**${member.user.username}** is already on the whitelist.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [...settings.trustedUsers, { id: member.id }] });
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);
		return reply(ctx, "Whitelist Updated", `${EMOJI.check} **${member.user.username}** added to the whitelist.`);
	}

	private async whitelistRemove(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first.`);

		const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
		if (!member) return reply(ctx, "Missing User", "Mention a user: `antinuke whitelist remove @user`");
		if (!settings.trustedUsers.some((u) => u.id === member.id)) {
			return reply(ctx, "Not Whitelisted", `**${member.user.username}** is not on the whitelist.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: settings.trustedUsers.filter((u) => u.id !== member.id) });
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);
		return reply(ctx, "Whitelist Updated", `${EMOJI.check} **${member.user.username}** removed from the whitelist.`);
	}

	private async whitelistList(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first.`);

		const users = settings.trustedUsers ?? [];
		if (!users.length) return reply(ctx, "Whitelist", "No users are currently whitelisted.");

		const lines = users.map((u, i) => `\`${i + 1}.\` <@${u.id}>`).join("\n");
		return reply(ctx, "Whitelist", `**${users.length}** whitelisted user${users.length !== 1 ? "s" : ""}\n\n${lines}`);
	}

	private async whitelistReset(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings.enabled) return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first.`);

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [] });
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated));
		ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);
		return reply(ctx, "Whitelist Cleared", `${EMOJI.check} All users have been removed from the whitelist.`);
	}

	// ─── Config (Interactive) ─────────────────────────────────────────────

	private async config(ctx: Context, settings: AntiNuke): Promise<any> {
		if (!settings?.enabled) {
			return reply(ctx, "Not Enabled", `${EMOJI.warn} Enable antinuke first with \`antinuke enable\`.`);
		}

		const buildOverview = (s: AntiNuke): string => [
			`Status: ${statusBadge(s.enabled)}`,
			"",
			"━━━━━━━━━━━━━━━━━━━━━━━",
			"**Module Overview**",
			"━━━━━━━━━━━━━━━━━━━━━━━",
			moduleStatus(s),
			"",
			"-# Select a module below to configure it.",
		].join("\n");

		const moduleMenu = new StringSelectMenuBuilder()
			.setCustomId("an:cfg:mod")
			.setPlaceholder("⚙ Select a module to configure")
			.addOptions([
				...Object.entries(MODULES).map(([key, meta]) => ({
					label: meta.label,
					value: key,
					description: meta.description,
				})),
				{ label: "Mention", value: "_mention", description: "Toggle @everyone / @here protection" },
				{ label: "GateKeeper", value: "_gateKeeper", description: "Toggle unauthorized bot-add protection" },
			]);

		const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(moduleMenu);
		const overviewPanel = panel("Configuration", buildOverview(settings));

		const msg = await ctx.editOrReply({
			components: [overviewPanel, menuRow],
			flags: MessageFlags.IsComponentsV2,
		});

		const filter = (i: any): boolean => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({ components: [panel("Access Denied", `${EMOJI.lock} Only the command author can use these controls.`)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch(() => {});
			return false;
		};

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.StringSelect,
			time: 120_000,
			filter,
		});

		collector.on("collect", async (int: StringSelectMenuInteraction) => {
			try {
				const selected = int.values[0];
				if (!selected) return;

				// Toggle switches for mention and gateKeeper
				if (selected === "_mention" || selected === "_gateKeeper") {
					const key = selected.slice(1); // "mention" or "gateKeeper"
					(settings as any)[key] = !(settings as any)[key];
					settings = await AntiNuke.update(ctx.guild.id!, { [key]: (settings as any)[key] });
					await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(settings));
					ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);

					const newPanel = panel("Configuration", buildOverview(settings));
					await int.update({ components: [newPanel, menuRow] }).catch(() => {});
					return;
				}

				// Module drill-down
				await this.showModuleConfig(int, selected as ModuleKey, settings, ctx, menuRow, filter, buildOverview);
			} catch {
				await int.reply({ components: [panel("Error", "An error occurred. Please try again.")], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch(() => {});
			}
		});

		collector.on("end", (_c, reason) => {
			if (reason === "time") {
				msg.edit({ components: [panel("Configuration", "Session expired. Run the command again."), menuRow] }).catch(() => {});
			}
		});
	}

	// ─── Module Config Drill-Down ─────────────────────────────────────────

	private async showModuleConfig(
		int: StringSelectMenuInteraction,
		module: ModuleKey,
		settings: AntiNuke,
		ctx: Context,
		menuRow: ActionRowBuilder<StringSelectMenuBuilder>,
		filter: (i: any) => boolean,
		buildOverview: (s: AntiNuke) => string,
	): Promise<void> {
		const meta = MODULES[module];
		const entries: any[] = (settings as any)[module] ?? [];

		const buildModuleView = (items: any[]): string => {
			const lines = items.map((e: any) => {
				const status = e.enabled ? "ON" : "OFF";
				return `**${capitalize(e.type)}** — ${status} | limit: \`${e.limit}\` | action: \`${e.action}\``;
			});

			return [
				`Module: **${meta.label}**`,
				`Description: ${meta.description}`,
				"",
				"────────────────────",
				"**Protection Types**",
				"────────────────────",
				...lines,
				"",
				"-# Click a button to configure limit and action for each type.",
			].join("\n");
		};

		const buildButtons = (items: any[]): ActionRowBuilder<ButtonBuilder>[] => {
			const rows: ActionRowBuilder<ButtonBuilder>[] = [];
			for (let i = 0; i < items.length; i += 4) {
				const chunk = items.slice(i, i + 4);
				rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
					chunk.map((e: any) =>
						new ButtonBuilder()
							.setCustomId(`an:t:${module}:${e.type}`)
							.setLabel(capitalize(e.type))
							.setStyle(e.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
					),
				));
			}
			rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("an:back").setLabel("Back").setStyle(ButtonStyle.Secondary),
			));
			return rows;
		};

		const modulePanel = panel(`${meta.label} Module`, buildModuleView(entries));
		const buttons = buildButtons(entries);

		await int.update({ components: [modulePanel, ...buttons] }).catch(() => {});

		const btnCollector = int.message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 90_000,
			filter,
		});

		btnCollector.on("collect", async (btn) => {
			try {
				if (btn.customId === "an:back") {
					btnCollector.stop("back");
					const refreshedPanel = panel("Configuration", buildOverview(settings));
					await btn.update({ components: [refreshedPanel, menuRow] }).catch(() => {});
					return;
				}

				const [, , targetModule, targetType] = btn.customId.split(":");
				if (!targetModule || !targetType) return;

				const moduleEntries: any[] = (settings as any)[targetModule] ?? [];
				const entry = moduleEntries.find((e: any) => e.type === targetType);
				if (!entry) return;

				// Open modal to configure this type
				const modal = new ModalBuilder()
					.setCustomId(`an:modal:${targetModule}:${targetType}`)
					.setTitle(`Configure ${capitalize(targetType)}`)
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId("an_enabled")
								.setLabel("Enabled (on / off)")
								.setStyle(TextInputStyle.Short)
								.setValue(entry.enabled ? "on" : "off")
								.setRequired(true),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId("an_limit")
								.setLabel("Limit (1-100)")
								.setStyle(TextInputStyle.Short)
								.setValue(String(entry.limit))
								.setRequired(false),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId("an_action")
								.setLabel("Action (ban / kick / rolestrip)")
								.setStyle(TextInputStyle.Short)
								.setValue(entry.action)
								.setRequired(false),
						),
					);

				await btn.showModal(modal);

				const modalInt = await btn.awaitModalSubmit({
					time: 60_000,
					filter: (i: any) => i.customId === `an:modal:${targetModule}:${targetType}` && i.user.id === ctx.author!.id,
				}).catch(() => null);

				if (!modalInt) return;

				// Parse values
				const enabledRaw = modalInt.fields.getTextInputValue("an_enabled").trim().toLowerCase();
				const limitRaw = modalInt.fields.getTextInputValue("an_limit").trim();
				const actionRaw = modalInt.fields.getTextInputValue("an_action").trim().toLowerCase();

				entry.enabled = enabledRaw === "on" || enabledRaw === "true" || enabledRaw === "yes" || enabledRaw === "1";

				if (limitRaw) {
					const parsed = parseInt(limitRaw, 10);
					if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) entry.limit = parsed;
				}

				if (actionRaw && ["ban", "kick", "rolestrip"].includes(actionRaw)) {
					entry.action = actionRaw;
				}

				settings = await AntiNuke.update(ctx.guild.id!, settings);
				await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(settings));
				ctx.client.services.antinukes.clearGuildConfig(ctx.guild.id!);

				const refreshed: any[] = (settings as any)[targetModule] ?? [];
				const refreshedPanel = panel(`${meta.label} Module`, buildModuleView(refreshed));
				const refreshedButtons = buildButtons(refreshed);
				await modalInt.update({ components: [refreshedPanel, ...refreshedButtons] }).catch(() => {});
			} catch {
				await btn.reply({ components: [panel("Error", "An error occurred.")], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch(() => {});
			}
		});

		btnCollector.on("end", (_c, reason) => {
			if (reason === "time") {
				int.message.edit({ components: [panel("Configuration", "Session expired."), menuRow] }).catch(() => {});
			}
		});
	}
}
