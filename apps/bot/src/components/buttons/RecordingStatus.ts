import { ButtonInteraction, EmbedBuilder, MessageFlags } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { voiceRecordingService } from "../../service/voiceRecordingService";
import { requireRecordingPremium } from "../../utils/recordingControls";

export default class RecordingStatus extends Button {
	constructor(client: BaseClient) {
		super(client, { id: "recording-status" });
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guildId || !(await requireRecordingPremium(interaction))) return;
		const status = voiceRecordingService.getStatus(interaction.guildId);
		if (!status) return interaction.reply({ content: "There is no active voice recording in this server.", flags: MessageFlags.Ephemeral });
		return interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setTitle("Recording Active")
					.setDescription(`Channel: <#${status.channelId}>\nStarted: <t:${Math.floor(status.startedAt / 1_000)}:R>\nSpeakers captured: **${status.speakers}**`),
			],
			flags: MessageFlags.Ephemeral,
		});
	}
}
