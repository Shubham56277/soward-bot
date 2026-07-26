import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, ContainerBuilder, Message, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Giveaway } from "@repo/db";

export default class GiveawayView extends Button {
	private currentPage = 0;
	private pages: ContainerBuilder[] = [];
	message: Message | undefined;
	constructor(client: BaseClient) {
		super(client, {
			id: "giveaway_view",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		const { guildId, message } = interaction;
		if (!guildId || !message) return;

		// Reset state on each execution
		this.currentPage = 0;
		this.pages = [];

		const giveaway = await Giveaway.get(guildId, message.id);
		if (!giveaway) {
			return interaction.reply({ content: "Giveaway not found", flags: MessageFlags.Ephemeral });
		}
		if (giveaway.ended) {
			return interaction.reply({ content: "This giveaway has already ended", flags: MessageFlags.Ephemeral });
		}

		const uniqueParticipants = Array.from(
			new Map(giveaway.participants!.map((u) => [u.id, u])).values()
		);

		const usersPerPage = 10;
		for (let i = 0; i < uniqueParticipants.length; i += usersPerPage) {
			const pageUsers = uniqueParticipants.slice(i, i + usersPerPage);

			const page = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Participants**"))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(pageUsers.map((user) => `<@${user.id}> (\`${user.id}\`)`).join("\n")))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Total: ${uniqueParticipants.length} users`));

			this.pages.push(page);
		}

		if (this.pages.length === 0) {
			throw new Error("No pages provided for pagination");
		}

		const components = this.createComponents();
		await interaction.reply({
			components: [this.pages[this.currentPage]!, components],
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		});
		this.message = await interaction.fetchReply();
		this.setupCollector();
	}

	private createComponents(): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("pagination_previous")
				.setLabel("◀")
				.setStyle(ButtonStyle.Primary)
				.setDisabled(this.currentPage === 0),
			new ButtonBuilder()
				.setCustomId("pagination_page")
				.setLabel(`${this.currentPage + 1}/${this.pages.length}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId("pagination_next")
				.setLabel("▶")
				.setStyle(ButtonStyle.Primary)
				.setDisabled(this.currentPage === this.pages.length - 1),
		);
	}

	private setupCollector(): void {
		const collector = this.message?.createMessageComponentCollector({
			time: 60000,
			componentType: ComponentType.Button,
		});

		collector?.on("collect", async (interaction) => {
			if (interaction.customId === "pagination_previous") {
				this.currentPage--;
			} else if (interaction.customId === "pagination_next") {
				this.currentPage++;
			}

			await interaction.update({
				components: [this.pages[this.currentPage]!, this.createComponents()],
			});
		});
	}
}
