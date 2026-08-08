import { ButtonInteraction, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room, VoiceSettings } from "@repo/db";

export default class Unhide extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-unhide",
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
			await voice.permissionOverwrites.edit(interaction.guild.roles.everyone, {
				ViewChannel: null, // Remove override so it inherits (visible)
			});
			const userVoiceSetting = await VoiceSettings.get(interaction.guild.id!, interaction.user.id);
			userVoiceSetting.visible = false; // visible=false means default (not hidden)
			await VoiceSettings.update(interaction.guild.id!, interaction.user.id, userVoiceSetting);
			return interaction.reply({
				content: "Unhidden the room.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
