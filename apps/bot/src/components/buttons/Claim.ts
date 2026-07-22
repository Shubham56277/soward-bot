import { ButtonInteraction, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room, VoiceSettings } from "@repo/db";

export default class Claim extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-claim",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guild) return;
		const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return;
		const room = await Room.get(voice.id);
		if (!room) return;
		const allMembers = voice.members;
		if (voice instanceof VoiceChannel) {
			// check is owner are in the room
			if (allMembers.find((member) => member.id === room.ownerId)) {
				return interaction.reply({
					content: "Owner is in the room.",
					flags: MessageFlags.Ephemeral,
				});
			}
			const userVoiceSetting = await VoiceSettings.get(interaction.guild.id!, interaction.user.id);
			voice.setName(userVoiceSetting.name);
			voice.setUserLimit(userVoiceSetting.userLimit);

			// claim the room
			await Room.update(voice.id, { ownerId: interaction.user.id });
			//
			return interaction.reply({
				content: "Claimed the room.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
