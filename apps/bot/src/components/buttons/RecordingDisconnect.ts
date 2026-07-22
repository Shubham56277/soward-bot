import { ButtonInteraction, GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { voiceRecordingService } from "../../service/voiceRecordingService";
import { requireRecordingPremium } from "../../utils/recordingControls";

export default class RecordingDisconnect extends Button {
	constructor(client: BaseClient) {
		super(client, { id: "recording-disconnect" });
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guildId || !(interaction.member instanceof GuildMember)) return;
		if (!(await requireRecordingPremium(interaction))) return;
		if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: "You need the Administrator permission to disconnect the recorder.", flags: MessageFlags.Ephemeral });
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const disconnected = await voiceRecordingService.disconnect(interaction.guildId);
		return interaction.editReply(
			disconnected
				? "Recorder disconnected. Any unfinished temporary recording was deleted without delivery."
				: "The recorder is not connected in this server.",
		);
	}
}
