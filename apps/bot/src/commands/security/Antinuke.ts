import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionsBitField,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextInputBuilder,
	TextInputStyle,
	User,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { capitalize } from "../../utils/helper";
import { env } from "@repo/env";
import {
	addTrustedUser,
	buildDisabledAntiNukePatch,
	buildSafeDefaultAntiNukePatch,
	infiniteVoidIsEnabled,
	moduleIsEnabled,
	normalizeTrustedUsers,
	parseDiscordUserId,
	removeTrustedUser,
	setInfiniteVoidEnabled,
} from "../../modules/antiNukeState";
import {
	ANTINUKE_ARROW,
	ANTINUKE_LOCK,
	ANTINUKE_OFF,
	ANTINUKE_TICK,
	ANTINUKE_WARNING,
	buildAntiNukePanel,
	formatSetupProgress,
} from "../../modules/antiNukeUi";

// ─── Constants ─────────────────────────────────────────────────────────────

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
type UserResolution = { user: User; error?: never } | { user: null; error: string };

const PUNISHMENTS: Punishment[] = ["ban", "kick", "rolestrip"];

const EMOJI = {
	on: ANTINUKE_TICK,
	off: ANTINUKE_OFF,
	lock: ANTINUKE_LOCK,
	warn: ANTINUKE_WARNING,
	check: ANTINUKE_TICK,
	arrow: ANTINUKE_ARROW,
} as const;

function panel(title: string, body: string): ContainerBuilder {
	return buildAntiNukePanel(title, [body]);
}

function plainPanel(title: string, body: string): ContainerBuilder {
	return buildAntiNukePanel(title, [body]);
}

/** Aligned `label ... value` row using a fixed-width label column. */
function row(label: string, value: string): string {
	return `\`${label.padEnd(16)}\` ${value}`;
}

function reply(ctx: Context, title: string, body: string): Promise<any> {
	return ctx.editOrReply({
		components: [panel(title, body)],
		flags: MessageFlags.IsComponentsV2,
		allowedMentions: { parse: [] },
	});
}

function statusBadge(enabled: boolean): string {
	return enabled ? `\`${EMOJI.on} ON\`` : `\`${EMOJI.off} OFF\``;
}

function moduleStatus(settings: AntiNuke): string {
	const lines: string[] = [];
	for (const [key, meta] of Object.entries(MODULES)) {
		const entries: any[] = (settings as any)[key] ?? [];
		const active = settings.enabled ? entries.filter((e: any) => e.enabled && e.type !== "infiniteVoid") : [];
		const badge = active.length > 0 ? `${EMOJI.on}` : `${EMOJI.off}`;
		const detail = active.length > 0 ? active.map((e: any) => e.type).join(", ") : "disabled";
		lines.push(`${badge} **${meta.label}** — ${detail}`);
	}
	lines.push(`${settings.enabled && settings.mention ? EMOJI.on : EMOJI.off} **Mention** — ${settings.enabled && settings.mention ? "active" : "disabled"}`);
	lines.push(`${settings.enabled && settings.gateKeeper ? EMOJI.on : EMOJI.off} **GateKeeper** — ${settings.enabled && settings.gateKeeper ? "active" : "disabled"}`);
	lines.push(`${infiniteVoidIsEnabled(settings) ? EMOJI.on : EMOJI.off} **Infinite Void** — ${infiniteVoidIsEnabled(settings) ? "50 confirmed kicks / 20 minutes" : "disabled"}`);
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
				{ name: "emergency", description: "View or configure Emergency Mass Member Protection", type: ApplicationCommandOptionType.Subcommand },
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
		// Trusted users receive the same command-level access as an AntiNuke owner.
		const trustedIds = normalizeTrustedUsers(settings.trustedUsers).map((user) => user.id);
		if (trustedIds.includes(userId)) return true;
		// Extra owners from Redis-based extra owner system
		const raw = await ctx.client.redis.get(`extraowners:${ctx.guild.id}`).catch((error) => {
			ctx.client.logger.error("[AntiNuke] Failed to read extra owners:", error);
			return null;
		});
		if (raw) {
			try {
				const owners = JSON.parse(raw) as { userId: string }[];
				if (owners.some(o => o.userId === userId)) return true;
			} catch (error) {
				ctx.client.logger.error("[AntiNuke] Invalid extra owners cache:", error);
			}
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
			} catch (error) {
				ctx.client.logger.error("[AntiNuke] Failed to load settings:", error);
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
				case "emergency": return this.emergency(ctx);
				default: return this.dashboard(ctx);
			}
		} catch (error) {
			ctx.client.logger.error("[AntiNuke] Command failed:", error);
			return reply(ctx, "Error", "An unexpected error occurred. Please try again.");
		}
	}

	// ─── Dashboard ────────────────────────────────────────────────────────

	private async dashboard(ctx: Context): Promise<any> {
		let settings: AntiNuke;
		try {
			settings = await AntiNuke.get(ctx.guild.id!);
		} catch (error) {
			ctx.client.logger.error("[AntiNuke] Dashboard load failed:", error);
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
			flags: MessageFlags.IsComponentsV2 as const,
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
				}).catch((error: unknown) => ctx.client.logger.error("[AntiNuke] Dashboard denial reply failed:", error));
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
						await btn.message.delete();
						return;
					default:
						return;
				}
				await btn.update(render(false));
			} catch (error) {
				ctx.client.logger.error("[AntiNuke] Dashboard interaction failed:", error);
			}
		});

		collector.on("end", (_c, reason) => {
			if (reason === "time") msg.edit(render(true)).catch((error) => {
				ctx.client.logger.error("[AntiNuke] Dashboard timeout edit failed:", error);
			});
		});
	}

	// ─── Dashboard pages ──────────────────────────────────────────────────

	/** Page 1 — Overview */
	private overviewPage(settings: AntiNuke): string {
		const moduleKeys = Object.keys(MODULES) as ModuleKey[];
		const enabledModules = settings.enabled
			? moduleKeys.filter((key) => moduleIsEnabled(settings, key)).length
				+ (settings.mention ? 1 : 0)
				+ (settings.gateKeeper ? 1 : 0)
				+ (infiniteVoidIsEnabled(settings) ? 1 : 0)
			: 0;
		const totalModules = moduleKeys.length + 3;

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
		const lines = (Object.keys(MODULES) as ModuleKey[]).map((key) =>
			row(MODULES[key].label, moduleIsEnabled(settings, key) ? "Enabled" : "Disabled"),
		);

		lines.push(row("Mention", settings.enabled && settings.mention ? "Enabled" : "Disabled"));
		lines.push(row("GateKeeper", settings.enabled && settings.gateKeeper ? "Enabled" : "Disabled"));
		lines.push(row("Infinite Void", infiniteVoidIsEnabled(settings) ? "Enabled" : "Disabled"));

		const header = settings.enabled
			? "Review the protection modules currently active."
			: "⚠️ **AntiNuke is disabled. Every protection module is disabled.** Run `?antinuke enable` to create the safe default configuration.";

		return [
			header,
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
			"`?wl <mention|userId>` — Grant a full normal AntiNuke bypass",
			"`?wl remove <mention|userId>` — Remove a bypass",
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

		const steps = [
			"Checking bot permissions and role hierarchy",
			"Creating or finding the Elfaria protection role",
			"Assigning the protection role",
			"Enabling AntiNuke modules",
			"Configuring Infinite Void",
			"Persisting the protection configuration",
			"Invalidating protection caches",
			"AntiNuke setup completed",
		] as const;
		let activeStep = 0;
		const render = (completed: number, active?: number, failure?: { index: number; message: string }) => ({
			components: [buildAntiNukePanel("Elfaria AntiNuke Setup", [
				"Setting up server protection with safe defaults.",
				formatSetupProgress(steps, { completed, active, failure }),
			])],
			flags: MessageFlags.IsComponentsV2 as const,
			allowedMentions: { parse: [] },
		});

		const message = await ctx.editOrReply(render(0, activeStep));
		const updateProgress = async (completed: number, active?: number, failure?: { index: number; message: string }) => {
			await message.edit(render(completed, active, failure)).catch((error: unknown) => {
				ctx.client.logger.error("[AntiNuke] Setup progress edit failed:", error);
			});
		};

		try {
			const botMember = await ctx.guild.members.fetch(ctx.client.user!.id);
			if (!botMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
				throw new Error("Bot is missing Administrator permission");
			}
			await updateProgress(1, ++activeStep);

			let role = ctx.guild.roles.cache.find((candidate) =>
				candidate.name === "Elfaria Sentinel" || candidate.name === "Soward Supreme",
			);
			if (!role) {
				role = await ctx.guild.roles.create({
					name: "Elfaria Sentinel",
					color: ctx.client.config.colors.main,
					permissions: [PermissionsBitField.Flags.Administrator],
					reason: "Elfaria AntiNuke activation",
				});
			}
			if (!botMember.roles.cache.has(role.id) && role.position >= botMember.roles.highest.position) {
				throw new Error("Protection role is above the bot's highest role");
			}
			await updateProgress(2, ++activeStep);

			if (!botMember.roles.cache.has(role.id)) await botMember.roles.add(role.id, "Elfaria AntiNuke activation");
			await updateProgress(3, ++activeStep);

			const patch = buildSafeDefaultAntiNukePatch();
			await updateProgress(4, ++activeStep);

			if (!patch.member?.some((entry) => entry.type === "infiniteVoid" && entry.enabled)) {
				throw new Error("Infinite Void safe defaults were not configured");
			}
			await updateProgress(5, ++activeStep);

			const saved = await AntiNuke.update(ctx.guild.id!, patch);
			await updateProgress(6, ++activeStep);

			await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, saved);
			await updateProgress(7, ++activeStep);

			// ── Sync V2: clear its Redis cache so it picks up enabled state ──
			await ctx.client.redis.del(`antinuke:config:${ctx.guild.id}`).catch(() => {});

			await updateProgress(steps.length);
			return message;
		} catch (error) {
			const messageText = error instanceof Error ? error.message : "Unknown setup error";
			ctx.client.logger.error(`[AntiNuke] Setup failed at step ${activeStep}:`, error);
			await updateProgress(activeStep, undefined, { index: activeStep, message: messageText });
			return message;
		}
	}

	// ─── Disable ──────────────────────────────────────────────────────────

	private async disable(ctx: Context, settings: AntiNuke): Promise<any> {
		const wasEnabled = settings.enabled;
		const updated = await AntiNuke.update(ctx.guild.id!, buildDisabledAntiNukePatch(settings));
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, updated);

		// ── Sync the V2 system: clear its Redis cache so it picks up disabled state ──
		// The V2 runtime (antinuke/antinuke/client/antinukeRuntime.ts) uses a Redis key
		// `antinuke:config:{guildId}` with 1-hour TTL, and an in-memory LRU (10s TTL).
		// Deleting the Redis key forces a fresh DB read on next evaluation.
		// Also update the V2 database directly so it reads `enabled: false`.
		await ctx.client.redis.del(`antinuke:config:${ctx.guild.id}`).catch((err: unknown) => {
			ctx.client.logger.error("[AntiNuke] Failed to invalidate V2 Redis cache:", err);
		});

		if (!wasEnabled) {
			return reply(ctx, "Already Disabled", `${EMOJI.check} Protection and every module are disabled.\nEmergency Mass Member Protection remains active (70 kick/ban actions).\n\nUse \`antinuke enable\` to re-activate.`);
		}
		return reply(ctx, "Protection Disabled", `${EMOJI.warn} Normal AntiNuke protections have been **disabled**.\n\nEmergency Mass Member Protection remains active at **70** kick/ban actions.\n\n-# Use \`antinuke enable\` to re-activate.`);
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
				`${EMOJI.arrow} \`ban\` — Permanently ban the offender`,
				`${EMOJI.arrow} \`kick\` — Kick the offender`,
				`${EMOJI.arrow} \`rolestrip\` — Remove manageable roles`,
			].join("\n");
			return reply(ctx, "Punishment", body);
		}

		const patch: Record<string, any> = {};
		for (const key of Object.keys(MODULES) as ModuleKey[]) {
			const entries: any[] = (settings as any)[key] ?? [];
			if (entries.length) {
				patch[key] = entries.map((e: any) => e.type === "infiniteVoid" ? e : { ...e, action: value });
			}
		}

		const updated = await AntiNuke.update(ctx.guild.id!, patch);
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, updated);

		return reply(ctx, "Punishment Updated", `${EMOJI.check} Default action set to **${value}** across all modules.`);
	}

	// ─── Emergency Mass Member Protection ─────────────────────────────────

	private async emergency(ctx: Context): Promise<any> {
		const body = [
			"**Emergency Mass Member Protection**",
			"",
			"This protection is **always active**, even when AntiNuke is disabled.",
			"",
			`${EMOJI.check} **Threshold:** 70 kick/ban actions in a rolling 10-minute window`,
			`${EMOJI.check} **Punishment:** Ban (or role-strip + timeout if unbannnable)`,
			`${EMOJI.check} **Scope:** Applies to all users except the server owner`,
			`${EMOJI.check} **Status:** Always On`,
			"",
			"When any single user reaches the threshold, they are immediately punished",
			"and the server owner is notified via DM.",
			"",
			"-# This protection cannot be disabled. It acts as a last-resort safety net.",
		].join("\n");
		return reply(ctx, "Emergency Protection", body);
	}

	// ─── Whitelist ────────────────────────────────────────────────────────

	private async resolveWhitelistUser(ctx: Context, prefixPosition: number): Promise<UserResolution> {
		if (ctx.isInteraction) {
			const user = ctx.options.getUser("user", false) as User | null;
			return user ? { user } : { user: null, error: "Select a Discord user." };
		}

		const raw = ctx.args[prefixPosition];
		const userId = parseDiscordUserId(raw);
		if (!userId) return { user: null, error: "Provide a valid user mention or 17-20 digit Discord user ID." };

		try {
			const member = await ctx.guild.members.fetch(userId);
			return { user: member.user };
		} catch {
			try {
				return { user: await ctx.client.users.fetch(userId) };
			} catch (error) {
				ctx.client.logger.error(`[AntiNuke] Failed to resolve whitelist user ${userId}:`, error);
				return { user: null, error: `No Discord user could be resolved for \`${userId}\`.` };
			}
		}
	}

	private async whitelistHelp(ctx: Context): Promise<any> {
		const body = [
			"**Manage users exempt from antinuke checks.**",
			"",
			`${EMOJI.arrow} \`antinuke whitelist add @user\``,
			`${EMOJI.arrow} \`antinuke whitelist remove @user\``,
			`${EMOJI.arrow} \`antinuke whitelist list\``,
			`${EMOJI.arrow} \`antinuke whitelist reset\``,
		].join("\n");
		return reply(ctx, "Whitelist", body);
	}

	private async whitelistAdd(ctx: Context, settings: AntiNuke): Promise<any> {
		const resolved = await this.resolveWhitelistUser(ctx, 2);
		if (!resolved.user) return reply(ctx, "Invalid User", resolved.error);
		const { user } = resolved;
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (trustedUsers.some((entry) => entry.id === user.id)) {
			return reply(ctx, "Already Whitelisted", `**${user.username}** is already on the whitelist.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: addTrustedUser(trustedUsers, user.id) });
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, updated);
		return reply(ctx, "Whitelist Updated", `${EMOJI.check} **${user.username}** added as a full AntiNuke bypass.`);
	}

	private async whitelistRemove(ctx: Context, settings: AntiNuke): Promise<any> {
		const resolved = await this.resolveWhitelistUser(ctx, 2);
		if (!resolved.user) return reply(ctx, "Invalid User", resolved.error);
		const { user } = resolved;
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (!trustedUsers.some((entry) => entry.id === user.id)) {
			await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id!, user.id);
			return reply(ctx, "Not Whitelisted", `**${user.username}** is not on the whitelist. Any legacy state was cleared.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: removeTrustedUser(trustedUsers, user.id) });
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id!, user.id);
		return reply(ctx, "Whitelist Updated", `${EMOJI.check} **${user.username}** removed from the whitelist.`);
	}

	private async whitelistList(ctx: Context, settings: AntiNuke): Promise<any> {
		const users = normalizeTrustedUsers(settings.trustedUsers);
		if (!users.length) return reply(ctx, "Whitelist", "No users are currently whitelisted.");

		const lines = await Promise.all(users.map(async (entry, index) => {
			const user = await ctx.client.users.fetch(entry.id).catch(() => null);
			return user
				? `${EMOJI.check} **${user.username}** (\`${entry.id}\`)`
				: `${EMOJI.check} \`${entry.id}\``;
		}));
		return reply(ctx, "Whitelist", `**${users.length}** whitelisted user${users.length !== 1 ? "s" : ""}\n\n${lines.join("\n")}`);
	}

	private async whitelistReset(ctx: Context, _settings: AntiNuke): Promise<any> {
		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [] });
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id!);
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
			"**Module Overview**",
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
				{ label: "Infinite Void", value: "_infiniteVoid", description: "50 confirmed kicks in a rolling 20-minute window" },
			]);

		const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(moduleMenu);
		const overviewPanel = panel("Configuration", buildOverview(settings));

		const msg = await ctx.editOrReply({
			components: [overviewPanel, menuRow],
			flags: MessageFlags.IsComponentsV2,
		});

		const filter = (i: any): boolean => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({ components: [panel("Access Denied", `${EMOJI.lock} Only the command author can use these controls.`)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch((error: unknown) => {
				ctx.client.logger.error("[AntiNuke] Configuration denial reply failed:", error);
			});
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

				if (selected === "_infiniteVoid") {
					settings = await AntiNuke.update(ctx.guild.id!, {
						member: setInfiniteVoidEnabled(settings, !infiniteVoidIsEnabled(settings)),
					});
					await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, settings);
					await int.update({ components: [panel("Configuration", buildOverview(settings)), menuRow] });
					return;
				}

				if (selected === "_mention" || selected === "_gateKeeper") {
					const key = selected.slice(1);
					(settings as any)[key] = !(settings as any)[key];
					settings = await AntiNuke.update(ctx.guild.id!, { [key]: (settings as any)[key] });
					await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, settings);
					await int.update({ components: [panel("Configuration", buildOverview(settings)), menuRow] });
					return;
				}

				// Module drill-down
				await this.showModuleConfig(int, selected as ModuleKey, settings, ctx, menuRow, filter, buildOverview);
			} catch (error) {
				ctx.client.logger.error("[AntiNuke] Configuration interaction failed:", error);
				await int.reply({ components: [panel("Error", "An error occurred. Please try again.")], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch((replyError: unknown) => {
					ctx.client.logger.error("[AntiNuke] Configuration error reply failed:", replyError);
				});
			}
		});

		collector.on("end", (_c, reason) => {
			if (reason === "time") {
				msg.edit({ components: [panel("Configuration", "Session expired. Run the command again."), menuRow] }).catch((error) => {
					ctx.client.logger.error("[AntiNuke] Configuration timeout edit failed:", error);
				});
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
		const entries: any[] = ((settings as any)[module] ?? []).filter((entry: any) => entry.type !== "infiniteVoid");

		const buildModuleView = (items: any[]): string => {
			const lines = items.map((e: any) => {
				const status = e.enabled ? "ON" : "OFF";
				return `**${capitalize(e.type)}** — ${status} | limit: \`${e.limit}\` | action: \`${e.action}\``;
			});

			return [
				`Module: **${meta.label}**`,
				`Description: ${meta.description}`,
				"",
				"**Protection Types**",
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

		await int.update({ components: [modulePanel, ...buttons] });

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
					await btn.update({ components: [refreshedPanel, menuRow] });
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
				await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id!, settings);

				const refreshed: any[] = ((settings as any)[targetModule] ?? []).filter((item: any) => item.type !== "infiniteVoid");
				const refreshedPanel = panel(`${meta.label} Module`, buildModuleView(refreshed));
				const refreshedButtons = buildButtons(refreshed);
				const response = { components: [refreshedPanel, ...refreshedButtons] };
				if (modalInt.isFromMessage()) await modalInt.update(response);
				else await modalInt.reply({ ...response, flags: MessageFlags.IsComponentsV2 });
			} catch (error) {
				ctx.client.logger.error("[AntiNuke] Module configuration failed:", error);
				await btn.reply({ components: [panel("Error", "An error occurred.")], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }).catch((replyError: unknown) => {
					ctx.client.logger.error("[AntiNuke] Module configuration error reply failed:", replyError);
				});
			}
		});

		btnCollector.on("end", (_c, reason) => {
			if (reason === "time") {
				int.message.edit({ components: [panel("Configuration", "Session expired."), menuRow] }).catch((error) => {
					ctx.client.logger.error("[AntiNuke] Module configuration timeout edit failed:", error);
				});
			}
		});
	}
}
