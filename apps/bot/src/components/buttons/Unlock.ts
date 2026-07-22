import { ButtonInteraction, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room, VoiceSettings } from "@repo/db";

export default class Unlock extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-unlock",
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
			await voice.permissionOverwrites.edit(interaction.guild.roles.everyone, {
				Connect: true,
			});
            const userVoiceSetting = await VoiceSettings.get(interaction.guild.id!, interaction.user.id);
			userVoiceSetting.locked = true;
			await VoiceSettings.update(interaction.guild.id!, interaction.user.id, userVoiceSetting);
			return interaction.reply({
				content: "Unlocked the room.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
