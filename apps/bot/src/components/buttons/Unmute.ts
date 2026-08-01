import { ActionRowBuilder, ButtonInteraction, MessageFlags, UserSelectMenuBuilder, VoiceChannel } from "discord.js";
import { Room } from "@repo/db";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";

export default class Unmute extends Button {
	constructor(client: BaseClient) {
		super(client, { id: "voice-unmute" });
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		const reply = (content: string) => interaction.reply({
			content,
			flags: MessageFlags.Ephemeral,
			allowedMentions: { parse: [] },
		});
		const guild = interaction.guild;
		if (!guild) return reply("This control is only available in a server.");

		const voice = guild.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return reply("You must be in a voice channel.");
		const room = await Room.get(voice.id);
		if (!room || !(voice instanceof VoiceChannel)) return reply("This is not a managed voice room.");
		if (room.ownerId !== interaction.user.id) return reply("You are not the owner of this room.");

		const menu = new UserSelectMenuBuilder()
			.setCustomId("voice-unmute-menu")
			.setPlaceholder("Select a member to unmute")
			.setMinValues(1)
			.setMaxValues(1);
		const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu);
		return interaction.reply({
			content: "Select a member to unmute.",
			components: [row],
			flags: MessageFlags.Ephemeral,
			allowedMentions: { parse: [] },
		});
	}
}
