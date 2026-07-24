import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, EmbedBuilder, Message, MessageFlags } from "discord.js";
import Context from "../lib/Context";
import { compactReplyText } from "./compactReply";

export class Pagination {
	private currentPage = 0;
	private message: Message | undefined;
	private timeout: NodeJS.Timeout | undefined;

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
		const collector = this.message?.createMessageComponentCollector({
			time: this.timeoutDuration,
			componentType: ComponentType.Button,
			filter: (interaction) => {
				if (interaction.user.id !== this.ctx.author?.id) {
					interaction.reply({
						content: compactReplyText("Only the command author can use these buttons."),
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			},
		});

		collector?.on("collect", async (interaction) => {
			if (interaction.customId === "pagination_first") {
				this.currentPage = 0;
			} else if (interaction.customId === "pagination_previous") {
				this.currentPage--;
			} else if (interaction.customId === "pagination_next") {
				this.currentPage++;
			} else if (interaction.customId === "pagination_last") {
				this.currentPage = this.embeds.length - 1;
			}

			await interaction.update({
				embeds: [this.embeds[this.currentPage]!],
				components: [this.createComponents()],
			});

			this.resetTimeout();
		});

		collector?.on("end", () => {
			this.cleanup();
		});

		this.resetTimeout();
	}

	private resetTimeout(): void {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(() => {
			this.cleanup();
		}, this.timeoutDuration);
	}

	private cleanup(): void {
		if (this.message?.editable) {
			const components = this.createComponents();
			// biome-ignore lint/complexity/noForEach: <explanation>
			components.components.forEach((component) => {
				component.setDisabled(true);
			});
			this.message
				.edit({
					components: [components],
				})
				.catch(() => {});
		}
		if (this.timeout) clearTimeout(this.timeout);
	}
}

/** Pagination for Components V2 (ContainerBuilder pages) */
export class ContainerPagination {
	private currentPage = 0;
	private message: Message | undefined;
	private timeout: NodeJS.Timeout | undefined;

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
		const collector = this.message?.createMessageComponentCollector({
			time: this.timeoutDuration,
			componentType: ComponentType.Button,
			filter: (interaction) => {
				if (interaction.user.id !== this.ctx.author?.id) {
					interaction.reply({
						content: compactReplyText("Only the command author can use these buttons."),
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			},
		});

		collector?.on("collect", async (interaction) => {
			if (interaction.customId === "cpg_first") this.currentPage = 0;
			else if (interaction.customId === "cpg_prev") this.currentPage--;
			else if (interaction.customId === "cpg_next") this.currentPage++;
			else if (interaction.customId === "cpg_last") this.currentPage = this.pages.length - 1;

			await interaction.update({ components: [this.pages[this.currentPage]!, this.createNav()] });
			this.resetTimeout();
		});

		collector?.on("end", () => { this.cleanup(); });
		this.resetTimeout();
	}

	private resetTimeout(): void {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(() => { this.cleanup(); }, this.timeoutDuration);
	}

	private cleanup(): void {
		if (this.message?.editable) {
			const nav = this.createNav();
			nav.components.forEach((c) => c.setDisabled(true));
			this.message.edit({ components: [this.pages[this.currentPage]!, nav] }).catch(() => {});
		}
		if (this.timeout) clearTimeout(this.timeout);
	}
}
