import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	GuildMember,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { env } from "@repo/env";

// ─── Action Categories ─────────────────────────────────────────────────────

const WHITELIST_ACTIONS = [
	{ key: "ban", label: "Ban" },
	{ key: "kick", label: "Kick" },
	{ key: "prune", label: "Prune" },
	{ key: "botAdd", label: "Bot Add" },
	{ key: "guildUpdate", label: "Server Update" },
	{ key: "memberRoleUpdate", label: "Member Role Update" },
	{ key: "linkRole", label: "Member Role Update (Power Roles)" },
	{ key: "channelCreate", label: "Channel Create" },
	{ key: "channelDelete", label: "Channel Delete" },
	{ key: "channelUpdate", label: "Channel Update" },
	{ key: "roleCreate", label: "Role Create" },
	{ key: "roleDelete", label: "Role Delete" },
	{ key: "roleUpdate", label: "Role Update" },
	{ key: "everyoneHerePing", label: "Mention Everyone/Here" },
	{ key: "webhookCreate", label: "Webhook Create" },
	{ key: "webhookUpdate", label: "Webhook Update" },
	{ key: "webhookDelete", label: "Webhook Delete" },
	{ key: "emojiCreate", label: "Emoji Create" },
	{ key: "emojiUpdate", label: "Emoji Update" },
	{ key: "emojiDelete", label: "Emoji Delete" },
	{ key: "stickerCreate", label: "Sticker Create" },
	{ key: "stickerUpdate", label: "Sticker Update" },
	{ key: "stickerDelete", label: "Sticker Delete" },
] as const;

type ActionKey = typeof WHITELIST_ACTIONS[number]["key"];

const CACHE_KEY = (guildId: string) => `c:${guildId}`;
const WL_STATE_KEY = (guildId: string, userId: string) => `wl:actions:${guildId}:${userId}`;

// ─── Command ───────────────────────────────────────────────────────────────

export default class WhitelistCommand extends Command {
	constructor() {
		super({
			name: "wl",
			description: {
				content: "Manage antinuke whitelist with per-action controls",
				examples: ["wl", "wl add @user", "wl remove @user", "wl list"],
				usage: "wl [add|remove|list|reset] [user]",
			},
			category: "security",
			aliases: ["whitelist"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// Check authorization
		if (!(await this.isAuthorized(ctx))) {
			return;
		}

		const sub = (ctx.args[0] ?? "").toLowerCase();

		if (!sub) return this.showHelp(ctx);

		switch (sub) {
			case "add": return this.addUser(ctx);
			case "remove": return this.removeUser(ctx);
			case "list": return this.listUsers(ctx);
			case "reset": return this.resetAll(ctx);
			default: return this.showHelp(ctx);
		}
	}

	private async isAuthorized(ctx: Context): Promise<boolean> {
		const userId = ctx.author?.id ?? "";
		if (userId === ctx.guild.ownerId || env.DEVELOPER_IDS.includes(userId)) return true;
		// Check extra owners
		const raw = await ctx.client.redis.get(`extraowners:${ctx.guild.id}`).catch(() => null);
		if (raw) {
			try {
				const owners = JSON.parse(raw) as { userId: string }[];
				if (owners.some(o => o.userId === userId)) return true;
			} catch {}
		}
		// Check antinuke admin
		const settings = await AntiNuke.get(ctx.guild.id!);
		if (settings.admin === userId) return true;
		return false;
	}

	private showHelp(ctx: Context): Promise<any> {
		const body = [
			"## Whitelist",
			"Manage which users are exempted from antinuke protection.",
			"",
			"`wl add @user` — Add user with action selection panel",
			"`wl remove @user` — Remove user from whitelist",
			"`wl list` — Show all whitelisted users",
			"`wl reset` — Clear all whitelisted users",
			"",
			"-# Whitelisted users can perform up to 25 actions per 10 minutes.",
		].join("\n");

		return ctx.sendMessage({ content: body });
	}

	private async addUser(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id!);
		if (!settings.enabled) return ctx.sendMessage("Antinuke must be enabled first.");

		const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
		if (!member) return ctx.sendMessage("Mention a user: `wl add @user`");

		// Load existing action state for this user (or default all disabled)
		const stateKey = WL_STATE_KEY(ctx.guild.id, member.id);
		const existingRaw = await ctx.client.redis.get(stateKey).catch(() => null);
		let enabledActions: Set<string> = new Set();

		if (existingRaw) {
			try {
				enabledActions = new Set(JSON.parse(existingRaw));
			} catch {}
		}

		// Check if already whitelisted
		const alreadyWhitelisted = settings.trustedUsers.some((u) => u.id === member.id);
		if (alreadyWhitelisted && existingRaw) {
			// Show current panel for editing
		}

		// Build the interactive panel
		const buildPanel = () => {
			const lines = WHITELIST_ACTIONS.map(a => {
				const enabled = enabledActions.has(a.key);
				const icon = enabled ? "✅" : "❌";
				return `${icon} **: ${a.label}**`;
			});

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${ctx.guild.name}`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Executor**\u2003\u2003**Target**\n\`${ctx.author!.username}\`\u2003\u2003\`${member.user.username}\``
				))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Powered by Elfaria`));

			return container;
		};

		// Select menu to toggle individual actions
		const buildSelectMenu = () => {
			const options = WHITELIST_ACTIONS.map(a => ({
				label: a.label,
				value: a.key,
				description: enabledActions.has(a.key) ? "Currently: Enabled" : "Currently: Disabled",
			}));

			return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("wl_toggle_select")
					.setPlaceholder("Choose Your Options")
					.setMinValues(1)
					.setMaxValues(options.length)
					.addOptions(options),
			);
		};

		const buildButtons = () => {
			return new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("wl_add_all").setLabel("Add This User To All Categories").setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId("wl_save").setLabel("Save & Confirm").setStyle(ButtonStyle.Success),
			);
		};

		const msg = await ctx.sendMessage({
			components: [buildPanel(), buildSelectMenu(), buildButtons()],
			flags: MessageFlags.IsComponentsV2,
			allowedMentions: { parse: [] },
		});

		const collector = msg.createMessageComponentCollector({
			time: 120_000,
			filter: (i) => i.user.id === ctx.author!.id,
		});

		collector.on("collect", async (i) => {
			if (i.customId === "wl_toggle_select" && i.isStringSelectMenu()) {
				// Toggle selected actions
				for (const value of i.values) {
					if (enabledActions.has(value)) {
						enabledActions.delete(value);
					} else {
						enabledActions.add(value);
					}
				}
				await i.update({
					components: [buildPanel(), buildSelectMenu(), buildButtons()],
				}).catch(() => {});

			} else if (i.customId === "wl_add_all" && i.isButton()) {
				// Enable all actions
				for (const a of WHITELIST_ACTIONS) {
					enabledActions.add(a.key);
				}
				await i.update({
					components: [buildPanel(), buildSelectMenu(), buildButtons()],
				}).catch(() => {});

			} else if (i.customId === "wl_save" && i.isButton()) {
				collector.stop("saved");

				// Save to Redis (per-user action state)
				await ctx.client.redis.set(stateKey, JSON.stringify([...enabledActions])).catch(() => {});

				// Add to trustedUsers if not already
				if (!settings.trustedUsers.some(u => u.id === member.id)) {
					const updated = await AntiNuke.update(ctx.guild.id!, {
						trustedUsers: [...settings.trustedUsers, { id: member.id }],
					});
					await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated)).catch(() => {});
				}

				const enabledCount = enabledActions.size;
				const totalCount = WHITELIST_ACTIONS.length;

				await i.update({
					components: [
						new ContainerBuilder()
							.addTextDisplayComponents(new TextDisplayBuilder().setContent(
								`✅ **${member.user.username}** has been whitelisted with **${enabledCount}/${totalCount}** action categories enabled.`
							)),
					],
				}).catch(() => {});
			}
		});

		collector.on("end", async (_c, reason) => {
			if (reason === "saved") return;
			// Timeout — disable components
			await msg.edit({
				components: [
					new ContainerBuilder()
						.addTextDisplayComponents(new TextDisplayBuilder().setContent("Whitelist configuration timed out.")),
				],
			}).catch(() => {});
		});
	}

	private async removeUser(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id!);
		const member = ctx.options.getMember("user", 1) as GuildMember | undefined;
		if (!member) return ctx.sendMessage("Mention a user: `wl remove @user`");

		if (!settings.trustedUsers.some(u => u.id === member.id)) {
			return ctx.sendMessage(`**${member.user.username}** is not whitelisted.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id!, {
			trustedUsers: settings.trustedUsers.filter(u => u.id !== member.id),
		});
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated)).catch(() => {});
		await ctx.client.redis.del(WL_STATE_KEY(ctx.guild.id, member.id)).catch(() => {});

		return ctx.sendMessage(`✅ **${member.user.username}** removed from whitelist.`);
	}

	private async listUsers(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id!);

		if (!settings.trustedUsers.length) {
			return ctx.sendMessage("No whitelisted users.");
		}

		const lines = await Promise.all(
			settings.trustedUsers.map(async (u, i) => {
				const user = await ctx.client.users.fetch(u.id).catch(() => null);
				const name = user?.username ?? u.id;
				return `${i + 1}. **${name}** (\`${u.id}\`)`;
			})
		);

		return ctx.sendMessage({
			content: `## Whitelisted Users (${settings.trustedUsers.length})\n${lines.join("\n")}\n\n-# Limit: 25 actions per 10 minutes`,
		});
	}

	private async resetAll(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id!);

		// Clear all action states
		for (const u of settings.trustedUsers) {
			await ctx.client.redis.del(WL_STATE_KEY(ctx.guild.id, u.id)).catch(() => {});
		}

		const updated = await AntiNuke.update(ctx.guild.id!, { trustedUsers: [] });
		await ctx.client.redis.set(CACHE_KEY(ctx.guild.id!), JSON.stringify(updated)).catch(() => {});

		return ctx.sendMessage(`✅ Whitelist cleared (${settings.trustedUsers.length} users removed).`);
	}
}
