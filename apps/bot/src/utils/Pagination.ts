import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ButtonInteraction,
	ComponentType,
	ContainerBuilder,
	EmbedBuilder,
	type InteractionCollector,
	Message,
	MessageFlags,
} from "discord.js";
import Context from "../lib/Context";
import { compactReplyText } from "./compactReply";

export class Pagination {
	private currentPage = 0;
	private message: Message | undefined;
	private collector: InteractionCollector<ButtonInteraction> | undefined;

	constructor(
		private readonly ctx: Context,
		private readonly embeds: EmbedBuilder[],
		private readonly timeoutDuration: number = 300000, // 5 minutes default
	) {}

	public async start(): Promise<void> {
		if (this.embeds.length === 0) {
			throw new Error("No embeds provided for pagination");
		}

		const components = this.createComponents();
		this.message = await this.ctx.editOrReply({
			embeds: [this.embeds[this.currentPage]!],
			components: [components],
		});

		this.setupCollector();
	}

	private createComponents(): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("pagination_first")
				.setLabel("|←")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(this.currentPage === 0),
			new ButtonBuilder()
				.setCustomId("pagination_previous")
				.setLabel("←")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(this.currentPage === 0),
			new ButtonBuilder()
				.setCustomId("pagination_page")
				.setLabel(`${this.currentPage + 1}/${this.embeds.length}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId("pagination_next")
				.setLabel("→")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(this.currentPage === this.embeds.length - 1),
			new ButtonBuilder()
				.setCustomId("pagination_last")
				.setLabel("→|")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(this.currentPage === this.embeds.length - 1),
		);
	}

	private setupCollector(): void {
		this.collector?.stop("replaced");
		const collector = this.message?.createMessageComponentCollector({
			idle: this.timeoutDuration,
			componentType: ComponentType.Button,
			filter: (interaction) => {
				if (interaction.user.id !== this.ctx.author?.id) {
					void interaction.reply({
						content: compactReplyText("Only the command author can use these buttons."),
						flags: MessageFlags.Ephemeral,
					}).catch(() => undefined);
					return false;
				}
				return true;
			},
		});
		this.collector = collector;

		collector?.on("collect", async (interaction) => {
			try {
				if (interaction.customId === "pagination_first") {
					this.currentPage = 0;
				} else if (interaction.customId === "pagination_previous") {
					this.currentPage = Math.max(0, this.currentPage - 1);
				} else if (interaction.customId === "pagination_next") {
					this.currentPage = Math.min(this.embeds.length - 1, this.currentPage + 1);
				} else if (interaction.customId === "pagination_last") {
					this.currentPage = this.embeds.length - 1;
				}

				await interaction.update({
					embeds: [this.embeds[this.currentPage]!],
					components: [this.createComponents()],
				});
			} catch {
				if (!interaction.deferred && !interaction.replied) {
					await interaction.deferUpdate().catch(() => undefined);
				}
			}
		});

		collector?.once("end", () => {
			if (this.collector === collector) this.collector = undefined;
			this.disableComponents();
		});
	}

	public stop(): void {
		const collector = this.collector;
		this.collector = undefined;
		if (collector && !collector.ended) collector.stop("stopped");
		this.disableComponents();
	}

	private disableComponents(): void {
		if (!this.message?.editable) return;
		const components = this.createComponents();
		for (const component of components.components) component.setDisabled(true);
		void this.message.edit({ components: [components] }).catch(() => undefined);
	}
}

/** Pagination for Components V2 (ContainerBuilder pages) */
export class ContainerPagination {
	private currentPage = 0;
	private message: Message | undefined;
	private collector: InteractionCollector<ButtonInteraction> | undefined;

	constructor(
		private readonly ctx: Context,
		private readonly pages: ContainerBuilder[],
		private readonly timeoutDuration: number = 300000,
	) {}

	public async start(): Promise<void> {
		if (this.pages.length === 0) throw new Error("No pages provided for pagination");

		const nav = this.createNav();
		this.message = await this.ctx.editOrReply({
			components: [this.pages[this.currentPage]!, nav],
			flags: MessageFlags.IsComponentsV2,
		});

		this.setupCollector();
	}

	private createNav(): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("cpg_first").setLabel("|←").setStyle(ButtonStyle.Secondary).setDisabled(this.currentPage === 0),
			new ButtonBuilder().setCustomId("cpg_prev").setLabel("←").setStyle(ButtonStyle.Secondary).setDisabled(this.currentPage === 0),
			new ButtonBuilder().setCustomId("cpg_page").setLabel(`${this.currentPage + 1}/${this.pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
			new ButtonBuilder().setCustomId("cpg_next").setLabel("→").setStyle(ButtonStyle.Secondary).setDisabled(this.currentPage === this.pages.length - 1),
			new ButtonBuilder().setCustomId("cpg_last").setLabel("→|").setStyle(ButtonStyle.Secondary).setDisabled(this.currentPage === this.pages.length - 1),
		);
	}

	private setupCollector(): void {
		this.collector?.stop("replaced");
		const collector = this.message?.createMessageComponentCollector({
			idle: this.timeoutDuration,
			componentType: ComponentType.Button,
			filter: (interaction) => {
				if (interaction.user.id !== this.ctx.author?.id) {
					void interaction.reply({
						content: compactReplyText("Only the command author can use these buttons."),
						flags: MessageFlags.Ephemeral,
					}).catch(() => undefined);
					return false;
				}
				return true;
			},
		});
		this.collector = collector;

		collector?.on("collect", async (interaction) => {
			try {
				if (interaction.customId === "cpg_first") this.currentPage = 0;
				else if (interaction.customId === "cpg_prev") this.currentPage = Math.max(0, this.currentPage - 1);
				else if (interaction.customId === "cpg_next") this.currentPage = Math.min(this.pages.length - 1, this.currentPage + 1);
				else if (interaction.customId === "cpg_last") this.currentPage = this.pages.length - 1;

				await interaction.update({ components: [this.pages[this.currentPage]!, this.createNav()] });
			} catch {
				if (!interaction.deferred && !interaction.replied) {
					await interaction.deferUpdate().catch(() => undefined);
				}
			}
		});

		collector?.once("end", () => {
			if (this.collector === collector) this.collector = undefined;
			this.disableComponents();
		});
	}

	public stop(): void {
		const collector = this.collector;
		this.collector = undefined;
		if (collector && !collector.ended) collector.stop("stopped");
		this.disableComponents();
	}

	private disableComponents(): void {
		if (!this.message?.editable) return;
		const nav = this.createNav();
		for (const component of nav.components) component.setDisabled(true);
		void this.message.edit({ components: [this.pages[this.currentPage]!, nav] }).catch(() => undefined);
	}
}
