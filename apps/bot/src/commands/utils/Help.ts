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

const COMMANDS_PER_PAGE = 16;
const HELP_TIMEOUT_MS = 5 * 60_000;

const CATEGORY_LABELS: Record<string, string> = {
	security: "Security",
	automod: "Automod",
	moderation: "Moderation",
	music: "Music",
	utils: "Utility",
	settings: "Bot Settings",
	fun: "Fun Commands",
	giveaway: "Giveaways",
	ticket: "Tickets",
	welcome: "Greetings",
	voice: "Voice Commands",
	voicemaster: "Voice Master",
	premium: "Premium",
	games: "Games",
};

interface HelpState {
	category: string | null;
	page: number;
	alphabetical: boolean;
}

export default class Help extends Command {
	public constructor() {
		super({
			name: "help",
			description: {
				content: "Browse commands or view detailed help for one command",
				examples: ["help", "help music", "help play"],
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
			options: [{ name: "command", description: "Command or category to view", type: 3, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const query = ctx.options.getString("command", false)?.trim().toLowerCase();
		const commands = [...ctx.client.commands.values()].filter((command) => command.category !== "dev");
		const categories = [...new Set(commands.map((command) => command.category).filter(Boolean) as string[])].sort((a, b) =>
			this.categoryLabel(a).localeCompare(this.categoryLabel(b)),
		);

		if (query && !categories.includes(query)) return this.showCommand(ctx, query, commands);
		return this.showBrowser(ctx, commands, categories, query ?? null);
	}

	private async showBrowser(ctx: Context, commands: CommandOptions[], categories: string[], initialCategory: string | null) {
		const prefix = (await Guild.get(ctx.guild.id))?.prefix || ctx.client.config.prefix;
		const state: HelpState = { category: initialCategory, page: 0, alphabetical: true };

		const render = (disabled = false) => {
			if (!state.category) return { components: [this.homeView(ctx, commands, categories, prefix, disabled)] };

			const categoryCommands = this.commandsForCategory(commands, state.category);
			const ordered = state.alphabetical ? [...categoryCommands].sort((a, b) => a.name.localeCompare(b.name)) : categoryCommands;
			const pages = this.chunk(ordered, COMMANDS_PER_PAGE);
			state.page = Math.max(0, Math.min(state.page, Math.max(0, pages.length - 1)));
			return {
				components: [
					this.categoryView(
						ctx,
						state,
						categories,
						pages[state.page] ?? [],
						ordered.length,
						Math.max(1, pages.length),
						prefix,
						disabled,
					),
				],
			};
		};

		const response = await ctx.editOrReply({ ...render(), flags: MessageFlags.IsComponentsV2 });
		const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : response;
		const collector = message.createMessageComponentCollector({ time: HELP_TIMEOUT_MS });

		collector.on("collect", async (interaction) => {
			if (interaction.user.id !== ctx.author?.id) {
				await interaction.reply({
					content: compactReplyText("Only the person who opened this help menu can control it."),
					flags: MessageFlags.Ephemeral,
				}).catch(() => undefined);
				return;
			}

			try {
				if (interaction.isStringSelectMenu() && interaction.customId === "help_category") {
					state.category = interaction.values[0] === "home" ? null : (interaction.values[0] ?? null);
					state.page = 0;
				} else if (interaction.isButton()) {
					if (interaction.customId === "help_previous") state.page -= 1;
					if (interaction.customId === "help_next") state.page += 1;
					if (interaction.customId === "help_sort") {
						state.alphabetical = !state.alphabetical;
						state.page = 0;
					}
					if (interaction.customId === "help_close") {
						collector.stop("closed");
						await interaction.deferUpdate().catch(() => undefined);
						await message.delete().catch(() => undefined);
						return;
					}
				}
				await interaction.update(render());
			} catch (error) {
				ctx.client.logger.error("[help] Component update failed", error);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: compactReplyText("This help control expired. Run the help command again."),
						flags: MessageFlags.Ephemeral,
					}).catch(() => undefined);
				}
			}
		});

		collector.on("end", async (_collected, reason) => {
			if (reason === "closed" || !message.editable) return;
			await message.edit(render(true)).catch(() => undefined);
		});
	}

	private homeView(ctx: Context, commands: CommandOptions[], categories: string[], prefix: string, disabled: boolean): ContainerBuilder {
		const botName = ctx.client.user?.username || "Soward";
		const avatar = ctx.client.user?.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png";
		const identity = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## Hey, I'm ${botName}`),
				new TextDisplayBuilder().setContent(
					`› **Prefix** \`${prefix}\`\n› **Help** \`${prefix}help <command>\`\n› **Commands** \`${commands.length}\``,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${botName} profile picture`));

		const container = new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addSectionComponents(identity)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Pro Tip**\n-# **Explore ${botName} Premium with \`/premium status\`.**`,
				),
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Links**\n[Invite Bot](${ctx.client.config.links.invite}) · [Support Server](${ctx.client.config.links.supportServer})`,
				),
			);
		container.addActionRowComponents(this.categoryMenu(categories, null, disabled));
		return container;
	}

	private categoryView(
		ctx: Context,
		state: HelpState,
		categories: string[],
		commands: CommandOptions[],
		total: number,
		pageCount: number,
		prefix: string,
		disabled: boolean,
	): ContainerBuilder {
		const label = this.categoryLabel(state.category!);
		const avatar = ctx.client.user?.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png";
		const commandLines = commands.flatMap((command) => {
			const subcommands = command.options?.filter((option) => option.type === 1).map((option) => option.name) ?? [];
			return [
				`› **\`${prefix}${command.name}\`**`,
				`-# **${command.description?.content || "No description provided."}**${subcommands.length ? ` · **Subcommands:** ${subcommands.map((name) => `\`${name}\``).join(" ")}` : ""}`,
			];
		});

		const heading = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`## ${label} Commands\n-# **${total} commands · Page ${state.page + 1}/${pageCount}**\n-# **Use \`${prefix}help <command>\` for details.**`,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${ctx.client.user?.username || "Bot"} profile picture`));
		const container = new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addSectionComponents(heading)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(commandLines.join("\n")));
		container.addActionRowComponents(this.navigationRow(state, pageCount, disabled));
		container.addActionRowComponents(this.categoryMenu(categories, state.category, disabled));
		return container;
	}

	private async showCommand(ctx: Context, query: string, commands: CommandOptions[]) {
		const command = ctx.client.commands.get(query);
		if (!command || command.category === "dev") {
			const suggestions = commands
				.filter((item) => item.name.includes(query))
				.slice(0, 5)
				.map((item) => `\`${item.name}\``)
				.join(" · ");
			const container = new ContainerBuilder()
				.setAccentColor(ctx.client.config.colors.red)
				.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Command not found"))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`I couldn't find \`${query}\`.${suggestions ? `\n-# Did you mean ${suggestions}?` : "\n-# Open `/help` to browse every module."}`,
					),
				);
			return ctx.editOrReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
		}

		const prefix = (await Guild.get(ctx.guild.id))?.prefix || ctx.client.config.prefix;
		const examples = command.description?.examples?.length ? command.description.examples : [command.name];
		const subcommands = command.options?.filter((option) => option.type === 1) ?? [];
		const requirements = [
			command.premium ? "Premium access" : null,
			command.permissions?.dev ? "Developer only" : null,
			command.player?.voice ? "Join a voice channel" : null,
			command.player?.active ? "Active music player" : null,
		].filter(Boolean) as string[];
		const subcommandText = subcommands.length
			? `\n\n**Subcommands**\n${subcommands.map((subcommand) => `\`${subcommand.name}\` - ${subcommand.description || "No description"}`).join("\n")}`
			: "";
		const avatar = ctx.client.user?.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png";
		const heading = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`## ${prefix}${command.name}\n**${command.description?.content || "No description provided."}**\n-# **${this.categoryLabel(command.category || "other")} · ${command.cooldown || 0}s cooldown**`,
				),
			)
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${ctx.client.user?.username || "Bot"} profile picture`));

		const container = new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addSectionComponents(heading)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Usage**\n› \`${prefix}${command.description?.usage || command.name}\`\n\n**Requirements**\n-# **${requirements.length ? requirements.join(" · ") : "None"}**`,
				),
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**Examples**\n${examples.slice(0, 5).map((example) => `› \`${prefix}${example}\``).join("\n")}${subcommandText}`,
				),
			);
		return ctx.editOrReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
	}

	private categoryMenu(categories: string[], selected: string | null, disabled: boolean) {
		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("help_category")
				.setPlaceholder("Select a module to configure")
				.setDisabled(disabled)
				.addOptions(
					{ label: "Home", description: "Return to the system overview", value: "home", default: selected === null },
					...categories.map((category) => ({
						label: this.categoryLabel(category),
						description: `Browse ${this.categoryLabel(category).toLowerCase()} commands`,
						value: category,
						default: selected === category,
					})),
				),
		);
	}

	private navigationRow(state: HelpState, pageCount: number, disabled: boolean) {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("help_previous").setLabel("←").setStyle(ButtonStyle.Secondary).setDisabled(disabled || state.page === 0),
			new ButtonBuilder().setCustomId("help_close").setLabel("×").setStyle(ButtonStyle.Danger).setDisabled(disabled),
			new ButtonBuilder().setCustomId("help_next").setLabel("→").setStyle(ButtonStyle.Secondary).setDisabled(disabled || state.page >= pageCount - 1),
			new ButtonBuilder().setCustomId("help_sort").setLabel(state.alphabetical ? "A-Z" : "Default").setStyle(ButtonStyle.Primary).setDisabled(disabled),
			new ButtonBuilder().setCustomId("help_page").setLabel(`${state.page + 1}/${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
		);
	}

	private commandsForCategory(commands: CommandOptions[], category: string) {
		if (category === "premium") return commands.filter((command) => command.premium || command.name === "premium");
		return commands.filter((command) => command.category === category && !command.premium && command.name !== "premium");
	}

	private categoryLabel(category: string) {
		return CATEGORY_LABELS[category] ?? category.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
	}

	private chunk<T>(items: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
		return chunks;
	}
}
