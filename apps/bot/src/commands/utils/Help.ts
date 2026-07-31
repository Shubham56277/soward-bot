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
	type Feature,
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

			// 3. Feature match
			for (const c of HELP_CATEGORIES) {
				const f = c.features.find(f => f.key === query || f.label.toLowerCase() === query);
				if (f) return this.startSession(ctx, prefix, {
					level: "feature", categoryKey: c.key, featureKey: f.key, commandName: null, history: [],
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
		const render = (disabled = false) => ({
			components: [this.buildView(ctx, prefix, state, disabled)],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		});

		const msg = await ctx.editOrReply(render());
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
					await message.delete().catch(() => undefined);
					return;
				}
				await message.edit(render()).catch(() => undefined);
			} catch (err) {
				await reportError(ctx.client, err, { source: "menu", command: "help", userId: ctx.author?.id, guildId: ctx.guild?.id, interactionId: i.id });
			}
		});

		collector.on("end", async (_c, reason) => {
			if (reason === "closed" || !message.editable) return;
			await message.edit(render(true)).catch(() => undefined);
		});

		return msg;
	}

	/** Mutates state based on the interaction. Returns "close" to end the session. */
	private applyInteraction(i: MessageComponentInteraction, state: NavState): "close" | void {
		const push = () => state.history.push({ level: state.level, categoryKey: state.categoryKey, featureKey: state.featureKey, commandName: state.commandName });

		// Dropdowns
		if (i.isStringSelectMenu()) {
			const value = i.values[0]!;
			if (i.customId === "help_category_select") {
				push();
				if (value === "home") {
					state.level = "home"; state.categoryKey = null; state.featureKey = null; state.commandName = null;
				} else {
					// Skip intermediate category landing — go directly to first feature
					const cat = getCategory(value);
					const firstFeature = cat?.features.filter(f => !f.comingSoon)[0];
					if (firstFeature) {
						state.level = "feature"; state.categoryKey = value; state.featureKey = firstFeature.key; state.commandName = null;
					} else {
						state.level = "category"; state.categoryKey = value; state.featureKey = null; state.commandName = null;
					}
				}
				return;
			}
			if (i.customId === "help_feature_select") {
				push();
				state.level = "feature"; state.featureKey = value; state.commandName = null;
				return;
			}
		}

		// Buttons
		if (i.isButton()) {
			switch (i.customId) {
				case "help_home":
				case "help_back": {
					const prev = state.history.pop();
					if (prev) { state.level = prev.level; state.categoryKey = prev.categoryKey; state.featureKey = prev.featureKey; state.commandName = prev.commandName; }
					else { state.level = "home"; state.categoryKey = null; state.featureKey = null; state.commandName = null; }
					return;
				}
				case "help_close":
					return "close";
				case "help_prev":
				case "help_next": {
					this.cycle(state, i.customId === "help_next" ? 1 : -1);
					return;
				}
			}
		}
	}

	/** Cycle Previous/Next within the current level (categories or features). */
	private cycle(state: NavState, dir: 1 | -1): void {
		if (state.level === "category" && state.categoryKey) {
			const idx = HELP_CATEGORIES.findIndex(c => c.key === state.categoryKey);
			const next = (idx + dir + HELP_CATEGORIES.length) % HELP_CATEGORIES.length;
			state.categoryKey = HELP_CATEGORIES[next]!.key;
		} else if (state.level === "feature" && state.categoryKey && state.featureKey) {
			const cat = getCategory(state.categoryKey)!;
			const feats = cat.features.filter(f => !f.comingSoon);
			const idx = feats.findIndex(f => f.key === state.featureKey);
			const next = (idx + dir + feats.length) % feats.length;
			state.featureKey = feats[next]!.key;
		} else if (state.level === "home") {
			// From home, next enters the first category
			state.level = "category";
			state.categoryKey = HELP_CATEGORIES[dir === 1 ? 0 : HELP_CATEGORIES.length - 1]!.key;
		}
	}

	// ─── View router ────────────────────────────────────────────────────────────

	private buildView(ctx: Context, prefix: string, state: NavState, disabled: boolean): ContainerBuilder {
		switch (state.level) {
			case "home":     return this.homeView(ctx, prefix, disabled);
			case "category": return this.categoryView(ctx, prefix, state.categoryKey!, disabled);
			case "feature":  return this.featureView(ctx, prefix, state.categoryKey!, state.featureKey!, disabled);
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
					`\u203a **Prefix** \`${prefix}\`\n` +
					`\u203a **Help** \`${prefix}help <command>\`\n` +
					`\u203a **Commands** \`${totalCommands}\``,
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

		const idx = HELP_CATEGORIES.findIndex(c => c.key === categoryKey) + 1;

		const cards = cat.features.map(f => {
			const tag = f.comingSoon ? " `Soon`" : f.premium ? " `Premium`" : "";
			return `**${f.label}**${tag}\n-# ${f.description}`;
		}).join("\n\n");

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${cat.label}`))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${cat.tagline}`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(cards))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Category ${idx}/${HELP_CATEGORIES.length}  ·  Select a feature to explore.`));

		container.addActionRowComponents(this.featureSelect(cat, null, disabled));
		container.addActionRowComponents(this.categorySelect(categoryKey, disabled));
		container.addActionRowComponents(this.navRow(disabled, { back: true, prevNext: true }));
		return container;
	}

	// ─── FEATURE ───────────────────────────────────────────────────────────────────

	private featureView(ctx: Context, prefix: string, categoryKey: string, featureKey: string, disabled: boolean): ContainerBuilder {
		const cat = getCategory(categoryKey);
		const feature = getFeature(categoryKey, featureKey);
		if (!cat || !feature) return this.categoryView(ctx, prefix, categoryKey, disabled);

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${feature.label}`))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${feature.description}`));

		// Status line for premium features
		if (feature.premium) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Status** Premium  ·  **Access** \`${prefix}premium redeem\``));
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

		if (feature.comingSoon || feature.groups.length === 0) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Coming soon** — this feature is in development."));
		} else {
			// Command groups with separators between them
			feature.groups.forEach((group, gi) => {
				const availableCommands = group.commands.filter(name => ctx.client.commands.has(name));
				const cmds = availableCommands.map(name => `\`${name}\``).join("  ");
				if (!cmds) return;
				// Tag the heading as Premium when the group is premium (either an
				// explicit "Premium" group or one whose commands are premium-only).
				const groupIsPremium = feature.premium || group.heading === "Premium" || availableCommands.every(name => ctx.client.commands.get(name)?.premium);
				const heading = groupIsPremium ? `${group.heading} \`Premium\`` : group.heading;
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${heading}**\n${cmds}`));
				if (gi < feature.groups.length - 1) {
					container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
				}
			});
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# \`${prefix}help <command>\` for full details on any command.`));

		container.addActionRowComponents(this.featureSelect(cat, featureKey, disabled));
		container.addActionRowComponents(this.navRow(disabled, { back: true, prevNext: true }));
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

	private navRow(disabled: boolean, opts: { back: boolean; prevNext: boolean }): ActionRowBuilder<ButtonBuilder> {
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
		return row;
	}

	private categorySelect(selected: string | null, disabled: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("help_category_select")
				.setPlaceholder("Select a category...")
				.setDisabled(disabled)
				.addOptions(
					HELP_CATEGORIES.map(c => ({
						label: c.label,
						description: c.tagline.slice(0, 90),
						value: c.key,
						emoji: c.emoji,
						default: selected === c.key,
					})),
				),
		);
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
