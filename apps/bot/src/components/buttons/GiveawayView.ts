import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, EmbedBuilder, Message, MessageFlags } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Giveaway } from "@repo/db";

export default class GiveawayView extends Button {
	private currentPage = 0;
	private embeds: EmbedBuilder[] = [];
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
		this.embeds = [];

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

			const em = new EmbedBuilder()
				.setColor(interaction.client.config.colors.main)
				.setTitle("Participants")
				.setDescription(pageUsers.map((user) => `<@${user.id}> (\`${user.id}\`)`).join("\n"))
				.setFooter({ text: `Total: ${uniqueParticipants.length} users` });

			this.embeds.push(em);
		}

		if (this.embeds.length === 0) {
			throw new Error("No embeds provided for pagination");
		}

		const components = this.createComponents();
		await interaction.reply({
			embeds: [this.embeds[this.currentPage]!],
			components: [components],
			flags: MessageFlags.Ephemeral,
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
				.setLabel(`${this.currentPage + 1}/${this.embeds.length}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId("pagination_next")
				.setLabel("▶")
				.setStyle(ButtonStyle.Primary)
				.setDisabled(this.currentPage === this.embeds.length - 1),
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
				embeds: [this.embeds[this.currentPage]!],
				components: [this.createComponents()],
			});
		});
	}
}
