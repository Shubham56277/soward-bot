import { Guild } from "@repo/db";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type MessageComponentInteraction,
} from "discord.js";
import type { CommandOptions } from "../../abstract/Command";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { compactReplyText } from "../../utils/compactReply";
import { reportError } from "../../utils/errorHandler";
import {
	HELP_CATEGORIES,
	COMMAND_LOCATION,
	getCategory,
	getFeature,
	type Category,
} from "../../config/helpArchitecture";

const HELP_TIMEOUT_MS = 5 * 60_000;

// ─── Navigation state ─────────────────────────────────────────────────────────

type Level = "home" | "category" | "feature" | "command";

interface NavState {
	level: Level;
	categoryKey: string | null;
	featureKey: string | null;
	commandName: string | null;
	/** history stack for the Back button */
	history: Array<Pick<NavState, "level" | "categoryKey" | "featureKey" | "commandName">>;
}

// ─── Emoji helper ────────────────────────────────────────────────────────────

/**
 * Parse a Discord custom emoji string into the format required by select menu options.
 * Accepts: <:name:id> or <a:name:id>
 * For application emojis, only the `id` is required — name is optional.
 * Returns: { id, name, animated } or undefined if parsing fails.
 */
function parseCustomEmoji(emojiStr: string | undefined): { id: string; name: string; animated: boolean } | undefined {
	if (!emojiStr) return undefined;
	const match = emojiStr.match(/<(a)?:(\w+):(\d+)>/);
	if (!match) return undefined;
	return { id: match[3]!, name: match[2]!, animated: match[1] === "a" };
}

export default class Help extends Command {
	public constructor() {
		super({
			name: "help",
			description: {
				content: "Browse Elfaria's features, or get details on any command.",
				examples: ["help", "help management", "help ban", "help music"],
				usage: "help [command or category]",
			},
			category: "utils",
			aliases: ["h", "commands"],
			cooldown: 5,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [{ name: "command", description: "Command or category name", type: 3, required: false }],
		});
	}

	// ─── Entry point ─────────────────────────────────────────────────────────────

	public async run(ctx: Context): Promise<any> {
		// Defer immediately for slash commands to avoid "didn't respond in time"
		if (ctx.isInteraction && ctx.interaction && !ctx.interaction.deferred && !ctx.interaction.replied) {
			await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
			(ctx as any).deferred = true;
		}

		const query = ctx.options.getString("command", false)?.trim().toLowerCase();
		const prefix = (await Guild.get(ctx.guild.id))?.prefix ?? ctx.client.config.prefix;

		if (query) {
			// 1. Exact command match
			const cmd = this.resolveCommand(ctx, query);
			if (cmd) return this.startSession(ctx, prefix, {
				level: "command", categoryKey: null, featureKey: null, commandName: cmd.name, history: [],
			});

			// 2. Category match
			const cat = HELP_CATEGORIES.find(c => c.key === query || c.label.toLowerCase() === query);
			if (cat) return this.startSession(ctx, prefix, {
				level: "category", categoryKey: cat.key, featureKey: null, commandName: null, history: [],
			});

			// 3. Feature match — redirect to category page
			for (const c of HELP_CATEGORIES) {
				const f = c.features.find(f => f.key === query || f.label.toLowerCase() === query);
				if (f) return this.startSession(ctx, prefix, {
					level: "category", categoryKey: c.key, featureKey: null, commandName: null, history: [],
				});
			}

			// 4. Fuzzy command match
			const fuzzy = this.fuzzyFind(ctx, query);
			if (fuzzy) return this.startSession(ctx, prefix, {
				level: "command", categoryKey: null, featureKey: null, commandName: fuzzy.name, history: [],
			});

			// 5. Nothing found
			return this.showNotFound(ctx, prefix, query);
		}

		return this.startSession(ctx, prefix, {
			level: "home", categoryKey: null, featureKey: null, commandName: null, history: [],
		});
	}

	// ─── Session / collector ───────────────────────────────────────────────────────

	private async startSession(ctx: Context, prefix: string, state: NavState): Promise<any> {
		const buildPayload = (disabled = false) => ({
			components: [this.buildView(ctx, prefix, state, disabled)],
			flags: MessageFlags.IsComponentsV2 | (ctx.isInteraction ? MessageFlags.Ephemeral : 0),
		});

		// Send initial message (ephemeral for slash, normal for prefix)
		const msg = await ctx.editOrReply(buildPayload());
		const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : msg;

		const collector = message.createMessageComponentCollector({ time: HELP_TIMEOUT_MS });

		collector.on("collect", async (i: MessageComponentInteraction) => {
			if (i.user.id !== ctx.author?.id) {
				await i.reply({ content: compactReplyText("Only the person who opened this menu can use it."), flags: MessageFlags.Ephemeral }).catch(() => undefined);
				return;
			}

			// ALWAYS defer first to prevent "didn't respond in time"
			await i.deferUpdate().catch(() => undefined);

			try {
				const handled = this.applyInteraction(i, state);
				if (handled === "close") {
					collector.stop("closed");
					// For ephemeral/DM — edit to show closed state instead of deleting
					await message.edit({ components: [], content: "-# Help session closed." }).catch(() => message.delete().catch(() => undefined));
					return;
				}
				await message.edit({ components: [this.buildView(ctx, prefix, state, false)], flags: MessageFlags.IsComponentsV2 }).catch(() => undefined);
			} catch (err) {
				await reportError(ctx.client, err, { source: "menu", command: "help", userId: ctx.author?.id, guildId: ctx.guild?.id, interactionId: i.id });
			}
		});

		collector.on("end", async (_c: any, reason: string) => {
			if (reason === "closed") return;
			// Disable components when session expires
			try {
				await message.edit({ components: [this.buildView(ctx, prefix, state, true)], flags: MessageFlags.IsComponentsV2 }).catch(() => undefined);
			} catch {}
		});

		return msg;
	}

	/** Mutates state based on the interaction. Returns "close" to end the session. */
	private applyInteraction(i: MessageComponentInteraction, state: NavState): "close" | void {
		// Dropdowns
		if (i.isStringSelectMenu()) {
			const value = i.values[0]!;
			if (i.customId === "help_category_select") {
				if (value === "home") {
					state.level = "home"; state.categoryKey = null; state.featureKey = null; state.commandName = null;
				} else {
					// Show all features of this category on one page
					state.level = "category"; state.categoryKey = value; state.featureKey = null; state.commandName = null;
				}
				return;
			}
		}

		// Buttons
		if (i.isButton()) {
			switch (i.customId) {
				case "help_home":
				case "help_back": {
					state.level = "home"; state.categoryKey = null; state.featureKey = null; state.commandName = null;
					return;
				}
				case "help_close":
					return "close";
				case "help_cat_prev": {
					if (state.categoryKey) {
						const idx = HELP_CATEGORIES.findIndex(c => c.key === state.categoryKey);
						const prev = (idx - 1 + HELP_CATEGORIES.length) % HELP_CATEGORIES.length;
						state.categoryKey = HELP_CATEGORIES[prev]!.key;
					}
					return;
				}
				case "help_cat_next": {
					if (state.categoryKey) {
						const idx = HELP_CATEGORIES.findIndex(c => c.key === state.categoryKey);
						const next = (idx + 1) % HELP_CATEGORIES.length;
						state.categoryKey = HELP_CATEGORIES[next]!.key;
					}
					return;
				}
			}
		}
	}

	// ─── View router ────────────────────────────────────────────────────────────

	private buildView(ctx: Context, prefix: string, state: NavState, disabled: boolean): ContainerBuilder {
		switch (state.level) {
			case "home":     return this.homeView(ctx, prefix, disabled);
			case "category": return this.categoryView(ctx, prefix, state.categoryKey!, disabled);
			case "command":  return this.commandView(ctx, prefix, state.commandName!, disabled);
			default:         return this.homeView(ctx, prefix, disabled);
		}
	}

	// ─── HOME ─────────────────────────────────────────────────────────────────────

	private homeView(ctx: Context, prefix: string, disabled: boolean): ContainerBuilder {
		const { client } = ctx;
		const botName = client.user?.username ?? "Elfaria";
		const avatar = client.user?.displayAvatarURL({ size: 512, forceStatic: false }) ?? "https://cdn.discordapp.com/embed/avatars/0.png";
		const totalCommands = [...client.commands.values()].filter(c => c.category !== "dev").length;

		const identity = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Hey, I'm ${botName}`),
				new TextDisplayBuilder().setContent(
					`-# <a:dot:1532821300773388299> **My prefix is :** \`${prefix}\`\n` +
					`-# <a:dot:1532821300773388299> **Type** : \`${prefix}help <command>\`\n` +
					`-# <a:dot:1532821300773388299> **Total commands** : \`${totalCommands}\``,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${botName} avatar`));

		// Clean centered box — uses simple ASCII for consistent mobile/desktop rendering
		const word = "S O V E R E I G N";
		const boxWidth = 30;
		const padding = Math.floor((boxWidth - word.length) / 2);
		const padRight = boxWidth - word.length - padding;
		const top = `┌${"─".repeat(boxWidth)}┐`;
		const mid = `│${" ".repeat(padding)}${word}${" ".repeat(padRight)}│`;
		const bottom = `└${"─".repeat(boxWidth)}┘`;
		const intro = [top, mid, bottom].join("\n");

		const container = new ContainerBuilder()
			.addSectionComponents(identity)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent("```ansi\n" + intro + "\n```"))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					"\u2003\u2003\u00b7 \u00b7 \u00b7\n" +
					`\u2003**‎ ‎ ‎ ‎ ‎ ‎ ‎ ‎ [Elfaria](${(ctx.client.config.links as any).premium ?? ctx.client.config.links.supportServer})** ৻ꪆ\n` +
					"\u2003‎ ‎ *Powerful. Elegant. All-in-one.*",
				),
			)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					"__**Pro Tip**__\nExplore Elfaria Premium for exclusive features",
				),
			);

		container.addActionRowComponents(this.categorySelect(null, disabled));
		container.addActionRowComponents(this.linkRow(ctx));
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Powered by [elfaria.in](${(ctx.client.config.links as any).website ?? ctx.client.config.links.supportServer})`));
		return container;
	}

	// ─── CATEGORY ──────────────────────────────────────────────────────────────────

	private categoryView(ctx: Context, prefix: string, categoryKey: string, disabled: boolean): ContainerBuilder {
		const cat = getCategory(categoryKey);
		if (!cat) return this.homeView(ctx, prefix, disabled);

		const catIdx = HELP_CATEGORIES.findIndex(c => c.key === categoryKey);
		const pageLabel = `${catIdx + 1}/${HELP_CATEGORIES.length}`;

		// Premium emoji
		const premiumEmoji = "<:elf_4008:1532801782462414988>";

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${cat.emoji}  **${cat.label}**`))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${cat.tagline}`));

		// Show ALL features and their commands on one page
		for (const feature of cat.features) {
			if (feature.comingSoon) {
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`__**${feature.label}**__ \`Soon\`\n-# Coming soon`));
				continue;
			}

			for (const group of feature.groups) {
				const availableCommands = group.commands.filter(name => ctx.client.commands.has(name));
				if (availableCommands.length === 0) continue;

				const cmds = availableCommands.map(name => `\`${name}\``).join(" . ");
				const isPremium = feature.premium || group.heading === "Premium" || availableCommands.every(name => ctx.client.commands.get(name)?.premium);
				const heading = isPremium ? `__**${group.heading}**__ ${premiumEmoji}` : `__**${group.heading}**__`;
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}\n${cmds}`));
			}
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Powered by Elfaria`));

		// Navigation: ◀ 🗑 ▶ ⌂ pageLabel + category dropdown
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("help_cat_prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("help_close").setLabel("🗑").setStyle(ButtonStyle.Danger).setDisabled(disabled),
				new ButtonBuilder().setCustomId("help_cat_next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("help_home").setLabel("⌂").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("help_page_label").setLabel(pageLabel).setStyle(ButtonStyle.Secondary).setDisabled(true),
			),
		);
		container.addActionRowComponents(this.categorySelect(categoryKey, disabled));
		return container;
	}

	// ─── FEATURE ───────────────────────────────────────────────────────────────────

	private featureView(ctx: Context, prefix: string, categoryKey: string, featureKey: string, disabled: boolean): ContainerBuilder {
		const cat = getCategory(categoryKey);
		const feature = getFeature(categoryKey, featureKey);
		if (!cat || !feature) return this.homeView(ctx, prefix, disabled);

		// Get feature index for page display
		const feats = cat.features.filter(f => !f.comingSoon);
		const featureIdx = feats.findIndex(f => f.key === featureKey);
		const pageLabel = `${featureIdx + 1}/${feats.length}`;

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${feature.label}`))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${feature.description}`));

		if (feature.premium) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Status** Premium  ·  **Access** \`${prefix}premium redeem\``));
		}

		if (feature.comingSoon || feature.groups.length === 0) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Coming soon** — this feature is in development."));
		} else {
			// Command groups — ZEON-style compact listing
			for (const group of feature.groups) {
				const availableCommands = group.commands.filter(name => ctx.client.commands.has(name));
				if (availableCommands.length === 0) continue;

				const cmds = availableCommands.map(name => `\`${prefix}${name}\``).join(" , ");
				const groupIsPremium = feature.premium || group.heading === "Premium" || availableCommands.every(name => ctx.client.commands.get(name)?.premium);
				const heading = groupIsPremium ? `**${group.heading}** \`PRO\`` : `**${group.heading}**`;
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}\n${cmds}`));
			}
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Powered by Elfaria`));

		container.addActionRowComponents(this.featureSelect(cat, featureKey, disabled));
		container.addActionRowComponents(this.navRow(disabled, { back: true, prevNext: true, pageLabel }));
		return container;
	}

	// ─── COMMAND ───────────────────────────────────────────────────────────────────

	private commandView(ctx: Context, prefix: string, commandName: string, disabled: boolean): ContainerBuilder {
		const command = ctx.client.commands.get(commandName);
		if (!command) return this.homeView(ctx, prefix, disabled);

		const examples = (command.description?.examples ?? [command.name]).filter(e => e && e !== "No examples provided").slice(0, 5);
		const subCmds = (command.options ?? []).filter(o => o.type === 1);
		const clientPerms = (command.permissions?.client ?? []) as string[];
		const userPerms = (command.permissions?.user ?? []) as string[];

		const location = COMMAND_LOCATION[command.name];
		const featureLabel = location ? getFeature(location.categoryKey, location.featureKey)?.label ?? "" : "";

		// Related commands = siblings in the same feature group
		const related = this.relatedCommands(ctx, command.name).slice(0, 6);

		const reqTags: string[] = [];
		if (command.premium) reqTags.push("`Premium`");
		if (command.permissions?.dev) reqTags.push("`Developer`");
		if (command.player?.voice) reqTags.push("`Voice Channel`");
		if (command.player?.active) reqTags.push("`Active Player`");

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## \`${prefix}${command.name}\``))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(command.description?.content ?? "No description available."))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`**Syntax**\n\`${prefix}${command.description?.usage ?? command.name}\``,
			));

		// Meta line
		const meta: string[] = [`**Category** ${featureLabel || command.category}`, `**Cooldown** ${command.cooldown ?? 0}s`];
		if (reqTags.length) meta.push(`**Requires** ${reqTags.join(" ")}`);
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta.join("  ·  ")));

		// Permissions
		if (clientPerms.length || userPerms.length) {
			const lines: string[] = [];
			if (userPerms.length) lines.push(`**You need** ${userPerms.map(p => `\`${p}\``).join(" ")}`);
			if (clientPerms.length) lines.push(`**I need** ${clientPerms.map(p => `\`${p}\``).join(" ")}`);
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
		}

		// Subcommands
		if (subCmds.length) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`**Subcommands**\n${subCmds.map(s => `\`${s.name}\``).join("  ")}`,
			));
		}

		// Examples
		if (examples.length) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`**Examples**\n${examples.map(e => `\`${prefix}${e}\``).join("\n")}`,
			));
		}

		// Related
		if (related.length) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`**Related** ${related.map(r => `\`${r}\``).join("  ")}`,
			));
		}

		container.addActionRowComponents(this.navRow(disabled, { back: true, prevNext: false }));
		return container;
	}

	// ─── NOT FOUND ───────────────────────────────────────────────────────────────

	private showNotFound(ctx: Context, prefix: string, query: string): Promise<any> {
		const suggestions = this.fuzzyList(ctx, query).slice(0, 5);
		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Nothing found for \`${query}\``))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				suggestions.length
					? `Did you mean:\n${suggestions.map(s => `\`${prefix}${s}\``).join("  ")}`
					: `Open \`${prefix}help\` to browse everything.`,
			));
		return ctx.editOrReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
	}

	// ─── Components ────────────────────────────────────────────────────────────────

	private linkRow(ctx: Context): ActionRowBuilder<ButtonBuilder> {
		const links = ctx.client.config.links;
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel("Invite").setStyle(ButtonStyle.Link).setURL(links.invite),
			new ButtonBuilder().setLabel("Support").setStyle(ButtonStyle.Link).setURL(links.supportServer),
		);
	}

	private navRow(disabled: boolean, opts: { back?: boolean; prevNext?: boolean; pageLabel?: string }): ActionRowBuilder<ButtonBuilder> {
		const row = new ActionRowBuilder<ButtonBuilder>();
		if (opts.prevNext) {
			row.addComponents(new ButtonBuilder().setCustomId("help_prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(disabled));
		}
		if (opts.back) {
			row.addComponents(new ButtonBuilder().setCustomId("help_back").setLabel("⌂").setStyle(ButtonStyle.Secondary).setDisabled(disabled));
		}
		if (opts.prevNext) {
			row.addComponents(new ButtonBuilder().setCustomId("help_next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(disabled));
		}
		row.addComponents(new ButtonBuilder().setCustomId("help_close").setLabel("🗑").setStyle(ButtonStyle.Danger).setDisabled(disabled));
		if (opts.pageLabel) {
			row.addComponents(new ButtonBuilder().setCustomId("help_page_label").setLabel(opts.pageLabel).setStyle(ButtonStyle.Secondary).setDisabled(true));
		}
		return row;
	}

	private categorySelect(selected: string | null, disabled: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
		const menu = new StringSelectMenuBuilder()
			.setCustomId("help_category_select")
			.setPlaceholder("↝ Please select a module.")
			.setDisabled(disabled);

		for (const c of HELP_CATEGORIES) {
			const emoji = parseCustomEmoji(c.emoji);
			const opt: any = {
				label: c.label,
				description: c.tagline.slice(0, 100),
				value: c.key,
				default: selected === c.key,
			};
			// For application emojis, pass only the id to avoid name mismatch issues
			if (emoji) opt.emoji = { id: emoji.id, animated: emoji.animated };
			menu.addOptions(opt);
		}

		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
	}

	private featureSelect(cat: Category, selected: string | null, disabled: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("help_feature_select")
				.setPlaceholder(`Select a ${cat.label} feature`)
				.setDisabled(disabled)
				.addOptions(
					cat.features.map(f => ({
						label: f.label + (f.comingSoon ? " (Soon)" : ""),
						description: f.description.slice(0, 90),
						value: f.key,
						default: selected === f.key,
					})),
				),
		);
	}

	// ─── Command resolution & fuzzy search ──────────────────────────────────────────

	private resolveCommand(ctx: Context, query: string): CommandOptions | undefined {
		const cmd = ctx.client.commands.get(query) ?? ctx.client.commands.get(ctx.client.aliases.get(query) ?? "");
		return cmd && cmd.category !== "dev" ? cmd : undefined;
	}

	private fuzzyFind(ctx: Context, query: string): CommandOptions | undefined {
		const list = this.fuzzyList(ctx, query);
		return list.length ? ctx.client.commands.get(list[0]!) : undefined;
	}

	/** Rank all commands by fuzzy similarity to the query, return names sorted best-first. */
	private fuzzyList(ctx: Context, query: string): string[] {
		const names = [...ctx.client.commands.values()].filter(c => c.category !== "dev").map(c => c.name);
		const scored = names
			.map(name => ({ name, score: this.similarity(query, name) }))
			.filter(s => s.score > 0.35)
			.sort((a, b) => b.score - a.score);
		return scored.map(s => s.name);
	}

	/** Combined substring + edit-distance similarity in [0,1]. */
	private similarity(a: string, b: string): number {
		a = a.toLowerCase(); b = b.toLowerCase();
		if (a === b) return 1;
		if (b.includes(a) || a.includes(b)) return 0.9;
		const dist = this.levenshtein(a, b);
		const max = Math.max(a.length, b.length);
		return max === 0 ? 0 : 1 - dist / max;
	}

	private levenshtein(a: string, b: string): number {
		const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
		for (let i = 1; i <= a.length; i++) {
			let prev = dp[0]!;
			dp[0] = i;
			for (let j = 1; j <= b.length; j++) {
				const tmp = dp[j]!;
				dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j]!, dp[j - 1]!) + 1;
				prev = tmp;
			}
		}
		return dp[b.length]!;
	}

	private relatedCommands(ctx: Context, name: string): string[] {
		const loc = COMMAND_LOCATION[name];
		if (!loc) return [];
		const feature = getFeature(loc.categoryKey, loc.featureKey);
		if (!feature) return [];
		return feature.groups
			.flatMap(g => g.commands)
			.filter(n => n !== name && ctx.client.commands.has(n));
	}

	private humanize(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return `${n}`;
	}
}
