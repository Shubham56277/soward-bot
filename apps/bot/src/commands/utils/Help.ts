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
} from "discord.js";
import type { CommandOptions } from "../../abstract/Command";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { compactReplyText } from "../../utils/compactReply";

const HELP_TIMEOUT_MS = 5 * 60_000;

const CATEGORY_LABELS: Record<string, string> = {
	security:    "Security",
	automod:     "Automod",
	moderation:  "Moderation",
	music:       "Music",
	utils:       "Utility",
	settings:    "Bot Settings",
	fun:         "Fun",
	giveaway:    "Giveaways",
	ticket:      "Tickets",
	welcome:     "Greetings",
	voice:       "Voice",
	voicemaster: "Voice Master",
	premium:     "Premium",
	games:       "Games",
	logging:     "Logging",
};

const CATEGORY_GROUPS: Record<string, Array<{ heading: string; filter: (cmd: CommandOptions) => boolean }>> = {
	automod: [
		{ heading: "Automod", filter: (c) => c.name.startsWith("automod") || c.name === "antiswear" || c.name === "badword" || c.name === "filter" },
	],
	moderation: [
		{ heading: "Moderation", filter: (c) => ["ban","kick","mute","unmute","warn","timeout","softban","unban","slowmode","purge","lock","unlock","nick","role","tempban","massban","modlogs","reason","note","clearwarn","deafen","undeafen","moveall","lockdown","unbanall","hideall","unhideall","lockall","unlockall","roleall","unslowmode","clone","hide","unhide","media","embed","invcrole","roleicon","nickname","nuke"].includes(c.name) },
	],
	fun: [
		{ heading: "Fun", filter: (c) => ["ship","wink","hug","kiss","slap","pat","poke","cry","nom","facepalm","gay","animal","color","aniquote","meme","fact","8ball","reverse"].includes(c.name) },
	],
	utils: [
		{ heading: "Utility", filter: (c) => ["ping","uptime","serverinfo","guildinfo","userinfo","avater","banner","boostcount","boosters","botinfo","channelinfo","emojiinfo","emojilist","firstmessage","invite","joinedat","lists","membercount","roleinfo","serverbanner","servericon","snipe","stats","users","vote","zipemoji","addemoji","afk","profile","noprefix","calc","remind","coinflip","rps","mediaonly"].includes(c.name) },
	],
	music: [
		{ heading: "Playback", filter: (c) => ["music","play","search","queue","skip","stop","pause","resume","nowplaying","replay","seek","volume","loop","shuffle","remove","clearqueue","skipto","247","autoplay"].includes(c.name) },
	],
	security: [
		{ heading: "AntiNuke",   filter: (c) => c.name.includes("antinuke") || c.name === "security" },
		{ heading: "Protection", filter: (c) => !c.name.includes("antinuke") && c.name !== "security" },
	],
};

interface HelpState {
	category: string | null;
	page: number;
	catIndex: number;
}

export default class Help extends Command {
	public constructor() {
		super({
			name: "help",
			description: {
				content: "Browse all commands or get details on a specific one",
				examples: ["help", "help music", "help play", "help ban"],
				usage: "help [command or category]",
			},
			category: "utils",
			aliases: ["h"],
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
		const query = ctx.options.getString("command", false)?.trim().toLowerCase();
		const allCommands = [...ctx.client.commands.values()].filter((c) => c.category !== "dev");
		const categories = [...new Set(allCommands.map((c) => c.category).filter(Boolean) as string[])]
			.sort((a, b) => this.label(a).localeCompare(this.label(b)));

		if (query) {
			const cmd = ctx.client.commands.get(query) ?? [...ctx.client.commands.values()].find(c => c.name === query);
			if (cmd && cmd.category !== "dev") return this.showCommandDetail(ctx, cmd);
			const catMatch = categories.find(c => c === query || this.label(c).toLowerCase() === query);
			if (catMatch) return this.showBrowser(ctx, allCommands, categories, catMatch);
			return this.showCommandNotFound(ctx, query, allCommands);
		}
		return this.showBrowser(ctx, allCommands, categories, null);
	}

	// ─── Category browser ─────────────────────────────────────────────────────────

	private async showBrowser(ctx: Context, allCommands: CommandOptions[], categories: string[], initialCategory: string | null) {
		const prefix = (await Guild.get(ctx.guild.id))?.prefix ?? ctx.client.config.prefix;
		const state: HelpState = {
			category:  initialCategory,
			page:      0,
			catIndex:  initialCategory ? Math.max(0, categories.indexOf(initialCategory)) : 0,
		};
		const totalPages = categories.length;

		const render = (disabled = false) => {
			if (!state.category) return { components: [this.homeView(ctx, allCommands, categories, prefix, disabled, totalPages)] };
			const catCmds = this.commandsForCategory(allCommands, state.category);
			return { components: [this.categoryPageView(ctx, state, categories, catCmds, prefix, disabled, totalPages)] };
		};

		const flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
		const response = await ctx.editOrReply({ ...render(), flags });
		const message  = ctx.isInteraction ? await ctx.interaction!.fetchReply() : response;
		const collector = message.createMessageComponentCollector({ time: HELP_TIMEOUT_MS });

		collector.on("collect", async (interaction) => {
			if (interaction.user.id !== ctx.author?.id) {
				await interaction.reply({
					content: compactReplyText("Only the person who opened this help menu can use it."),
					flags: MessageFlags.Ephemeral,
				}).catch(() => undefined);
				return;
			}
			try {
				if (interaction.isStringSelectMenu() && interaction.customId === "help_module") {
					await interaction.deferUpdate().catch(() => undefined);
					const val = interaction.values[0];
					if (val === "home") { state.category = null; state.page = 0; state.catIndex = 0; }
					else { state.category = val ?? null; state.catIndex = categories.indexOf(val ?? ""); state.page = 0; }
					await interaction.editReply(render()).catch(() => undefined);
					return;
				}
				if (!interaction.isButton()) return;
				switch (interaction.customId) {
					case "help_delete":
						collector.stop("deleted");
						await interaction.deferUpdate().catch(() => undefined);
						await message.delete().catch(() => undefined);
						return;
					case "help_prev_cat": {
						const i = (state.catIndex - 1 + categories.length) % categories.length;
						state.catIndex = i; state.category = categories[i] ?? null; state.page = 0; break;
					}
					case "help_next_cat": {
						const i = (state.catIndex + 1) % categories.length;
						state.catIndex = i; state.category = categories[i] ?? null; state.page = 0; break;
					}
					case "help_sort":
						state.category = null; state.page = 0; state.catIndex = 0; break;
				}
				await interaction.update(render());
			} catch (err) {
				ctx.client.logger.error("[help] collector error", err);
			}
		});

		collector.on("end", async (_c, reason) => {
			if (reason === "deleted" || !message.editable) return;
			await message.edit(render(true)).catch(() => undefined);
		});
	}

	// ─── Home view ────────────────────────────────────────────────────────────────

	private homeView(
		ctx: Context,
		allCommands: CommandOptions[],
		categories: string[],
		prefix: string,
		disabled: boolean,
		_totalPages: number,
	): ContainerBuilder {
		const botName = ctx.client.user?.username ?? "Elfaria";
		const avatar  = ctx.client.user?.displayAvatarURL() ?? "https://cdn.discordapp.com/embed/avatars/0.png";

		const identity = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Hey, I'm ${botName}`),
				new TextDisplayBuilder().setContent(
					`\u203a **Prefix** \`${prefix}\`\n` +
					`\u203a **Help** \`${prefix}help <command>\`\n` +
					`\u203a **Commands** \`${allCommands.length}\``,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${botName} avatar`));

		// ANSI box — width 28 (safe on mobile without wrapping), centered Supreme
		const B  = "\x1b[1;34m";
		const C  = "\x1b[0;36m";
		const R  = "\x1b[0m";
		const W  = 28;
		const word  = "S  U  P  R  E  M  E";   // 19 chars
		const inner = W - 2;                     // 26 inner chars
		const pad   = " ".repeat(Math.floor((inner - word.length) / 2));
		const extra = " ".repeat(inner - pad.length - word.length);
		const top    = `${B}  ╔${"═".repeat(inner)}╗${R}`;
		const mid    = `${B}  ║${R}${pad}${C}${word}${R}${extra}${B}║${R}`;
		const bottom = `${B}  ╚${"═".repeat(inner)}╝${R}`;
		const intro  = [top, mid, bottom].join("\n");

		const container = new ContainerBuilder()
			.addSectionComponents(identity)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent("```ansi\n" + intro + "\n```"),
			)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`__**Pro Tip**__\n[Explore Elfaria Premium for exclusive features — AI, music tools, voice recording & much more.](${ctx.client.config.links.supportServer})`,
				),
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Links**\n[Invite Bot](${ctx.client.config.links.invite}) \u00b7 [Support Server](${ctx.client.config.links.supportServer})`,
				),
			);

		container.addActionRowComponents(this.moduleSelect(categories, null, disabled));
		return container;
	}

	// ─── Category page view ───────────────────────────────────────────────────────

	private categoryPageView(
		ctx: Context,
		state: HelpState,
		categories: string[],
		commands: CommandOptions[],
		prefix: string,
		disabled: boolean,
		totalPages: number,
	): ContainerBuilder {
		const catLabel = this.label(state.category!);
		const groups   = CATEGORY_GROUPS[state.category!];
		let bodyText: string;

		if (groups) {
			const parts: string[] = [];
			for (const group of groups) {
				const matching = commands.filter(group.filter);
				const src      = matching.length === 0 ? commands : matching;
				if (!src.length) continue;
				parts.push(`**${group.heading}**\n${src.map(c => `\`${c.name}\``).join("  \u00b7  ")}`);
			}
			const matched   = new Set(groups.flatMap(g => commands.filter(g.filter).map(c => c.name)));
			const unmatched = commands.filter(c => !matched.has(c.name));
			if (unmatched.length) parts.push(`**Other**\n${unmatched.map(c => `\`${c.name}\``).join("  \u00b7  ")}`);
			bodyText = parts.join("\n\n");
		} else {
			bodyText = commands.map(c => `\`${c.name}\``).join("  \u00b7  ");
		}

		const pageLabel = `${state.catIndex + 1}/${totalPages}`;

		const container = new ContainerBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**${catLabel}**\n\n${bodyText || "_No commands in this category._"}`,
				),
			)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`-# \`${prefix}help <command>\` for details  \u00b7  Powered by ${ctx.client.user?.username ?? "Elfaria"}`,
				),
			);

		container.addActionRowComponents(this.navRow(disabled, state.catIndex, totalPages, false, pageLabel));
		container.addActionRowComponents(this.moduleSelect(categories, state.category, disabled));
		return container;
	}

	// ─── Command detail view ───────────────────────────────────────────────────────

	private async showCommandDetail(ctx: Context, command: CommandOptions): Promise<any> {
		const prefix     = (await Guild.get(ctx.guild.id))?.prefix ?? ctx.client.config.prefix;
		const catLabel   = this.label(command.category ?? "other");
		const cooldown   = `${command.cooldown ?? 0}s`;
		const examples   = (command.description?.examples ?? [command.name]).slice(0, 5);
		const subCmds    = (command.options ?? []).filter(o => o.type === 1);
		const clientPerms = (command.permissions?.client ?? []) as string[];

		const reqTags: string[] = [];
		if (command.premium)           reqTags.push("`Premium`");
		if (command.permissions?.dev)  reqTags.push("`Dev Only`");
		if (command.player?.voice)     reqTags.push("`Voice Channel`");
		if (command.player?.active)    reqTags.push("`Active Player`");

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Help: ${command.name}**`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${command.description?.content ?? "No description."}**`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Category**\n\`${catLabel}\`\u2003\u2003**Cooldown**\n\`${cooldown}\``))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Usage**\n\`${prefix}${command.description?.usage ?? command.name}\``))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Examples**\n${examples.map(e => `\`${prefix}${e}\``).join("  ")}`));

		if (clientPerms.length > 0 || reqTags.length > 0) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			const lines: string[] = [];
			if (clientPerms.length) lines.push(`**Permissions Required**\nClient: ${clientPerms.map(p => `\`${p}\``).join("  ,  ")}`);
			if (reqTags.length)     lines.push(`**Requirements**: ${reqTags.join("  ")}`);
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
		}

		if (command.aliases?.length) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Aliases**\n${command.aliases.map(a => `\`${a}\``).join("  ")}`));
		}

		container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		container.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("help_cmd_subs").setLabel("View Subcommands").setStyle(ButtonStyle.Primary).setDisabled(subCmds.length === 0),
				new ButtonBuilder().setCustomId("help_cmd_examples").setLabel("View Examples").setStyle(ButtonStyle.Secondary),
			),
		);

		const flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
		const msg   = await ctx.editOrReply({ components: [container], flags });
		const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : msg;

		const collector = message.createMessageComponentCollector({ filter: i => i.user.id === ctx.author?.id, time: HELP_TIMEOUT_MS });
		collector.on("collect", async (i) => {
			if (i.customId === "help_cmd_subs") {
				if (!subCmds.length) { await i.deferUpdate(); return; }
				const subText = subCmds.map(s => `\`${s.name}\` \u2014 ${s.description ?? "No description"}`).join("\n");
				await i.reply({ content: `**Subcommands for \`${command.name}\`:**\n${subText}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
			} else if (i.customId === "help_cmd_examples") {
				const exText = examples.map(e => `\`${prefix}${e}\``).join("\n");
				await i.reply({ content: `**Examples for \`${command.name}\`:**\n${exText}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
			}
		});
		return msg;
	}

	// ─── Command not found ────────────────────────────────────────────────────────

	private showCommandNotFound(ctx: Context, query: string, commands: CommandOptions[]) {
		const suggestions = commands
			.filter(c => c.name.includes(query) || query.includes(c.name))
			.slice(0, 5).map(c => `\`${c.name}\``).join("  ");
		const container = new ContainerBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Command not found: \`${query}\`**\n\n` +
					(suggestions ? `Did you mean: ${suggestions}?` : `Use \`help\` to browse all modules.`),
				),
			);
		return ctx.editOrReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
	}

	// ─── Shared components ────────────────────────────────────────────────────────

	private navRow(disabled: boolean, _catIndex: number, totalPages: number, isHome: boolean, pageLabel?: string): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("help_prev_cat").setLabel("\u2039").setStyle(ButtonStyle.Secondary).setDisabled(disabled || isHome || totalPages <= 1),
			new ButtonBuilder().setCustomId("help_delete").setLabel("\uD83D\uDDD1").setStyle(ButtonStyle.Danger).setDisabled(disabled),
			new ButtonBuilder().setCustomId("help_next_cat").setLabel("\u203a").setStyle(ButtonStyle.Secondary).setDisabled(disabled || isHome || totalPages <= 1),
			new ButtonBuilder().setCustomId("help_sort").setLabel("\u2302").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("help_page_indicator").setLabel(pageLabel ?? "Home").setStyle(ButtonStyle.Secondary).setDisabled(true),
		);
	}

	private moduleSelect(categories: string[], selected: string | null, disabled: boolean): ActionRowBuilder<StringSelectMenuBuilder> {
		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("help_module")
				.setPlaceholder("\u21b3 Select a module to see")
				.setDisabled(disabled)
				.addOptions(
					{ label: "Home", description: "Return to overview", value: "home", default: selected === null },
					...categories.map(cat => ({
						label: this.label(cat),
						description: `Browse ${this.label(cat)} commands`,
					
						value: cat,
						default: selected === cat,
					})),
				),
		);
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────────

	private commandsForCategory(commands: CommandOptions[], category: string): CommandOptions[] {
		if (category === "premium") return commands.filter(c => c.premium || c.name === "premium");
		return commands.filter(c => c.category === category && !c.premium && c.name !== "premium");
	}

	private label(category: string): string {
		return CATEGORY_LABELS[category] ?? category.replace(/[-_]/g, " ").replace(/\b\w/g, l => l.toUpperCase());
	}
}