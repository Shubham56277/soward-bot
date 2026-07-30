import { ButtonInteraction, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room, VoiceSettings } from "@repo/db";

export default class Decrease extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-decrease-limit",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guild) return;
		const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return interaction.reply({ content: "You must be in a voice channel.", flags: MessageFlags.Ephemeral });
		const room = await Room.get(voice.id);
		if (!room) return interaction.reply({ content: "This is not a managed voice room.", flags: MessageFlags.Ephemeral });
		if (room.ownerId !== interaction.user.id) {
			return interaction.reply({
				content: "You are not the owner of this room.",
				flags: MessageFlags.Ephemeral,
			});
		}
		if (voice instanceof VoiceChannel) {
			const currentLimit = voice.userLimit;
			if (currentLimit <= 1) {
				return interaction.reply({
					content: "Cannot decrease limit below 1.",
					flags: MessageFlags.Ephemeral,
				});
			}
			await voice.setUserLimit(currentLimit - 1);
			const userVoiceSetting = await VoiceSettings.get(interaction.guild.id!, interaction.user.id);
			userVoiceSetting.userLimit = currentLimit - 1;
			await VoiceSettings.update(interaction.guild.id!, interaction.user.id, userVoiceSetting);
			return interaction.reply({
				content: `Decreased the limit to ${currentLimit - 1}.`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
