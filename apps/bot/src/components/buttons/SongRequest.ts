import {
    ActionRowBuilder,
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";

export default class SongRequest extends Button {
    constructor(client: BaseClient) {
        super(client, { id: "song_request_open" });
    }

    public async execute(interaction: ButtonInteraction): Promise<void> {
        const modal = new ModalBuilder()
            .setCustomId("song_request_modal")
            .setTitle("Request a Song");

        const songInput = new TextInputBuilder()
            .setCustomId("song_request_input")
            .setLabel("Song name / artist (be as specific as you can)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Humsafar - Saiyaara by Sachet Tandon")
            .setMinLength(2)
            .setMaxLength(200)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(songInput),
        );

        await interaction.showModal(modal);
    }
}
