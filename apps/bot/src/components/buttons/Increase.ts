import { ButtonInteraction, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room, VoiceSettings } from "@repo/db";

export default class Increase extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-increase-limit",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guild) return;
		const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return;
		const room = await Room.get(voice.id);
		if (!room) return;
		if (room.ownerId !== interaction.user.id) {
			return interaction.reply({
				content: "You are not the owner of this room.",
				flags: MessageFlags.Ephemeral,
			});
		}
		if (voice instanceof VoiceChannel) {
			// lock the channel
			const currentLimit = voice.userLimit;
			await voice.setUserLimit(currentLimit + 1);
			const userVoiceSetting = await VoiceSettings.get(interaction.guild.id!, interaction.user.id);
			userVoiceSetting.userLimit = currentLimit + 1;
			await VoiceSettings.update(interaction.guild.id!, interaction.user.id, userVoiceSetting);
			return interaction.reply({
				content: `Increased the limit to ${currentLimit + 1}.`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
