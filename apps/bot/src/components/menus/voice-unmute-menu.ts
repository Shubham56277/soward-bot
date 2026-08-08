import { MessageFlags, UserSelectMenuInteraction, VoiceChannel } from "discord.js";
import { Room } from "@repo/db";
import Menu from "../../abstract/Menu";
import BaseClient from "../../base/Client";

export default class UnmuteMenu extends Menu {
	constructor(client: BaseClient) {
		super(client, { id: "voice-unmute-menu" });
	}

	public async execute(interaction: UserSelectMenuInteraction): Promise<any> {
		const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		const guild = interaction.guild;
		if (!guild) return reply("This control is only available in a server.");

		const voice = guild.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return reply("You must be in a voice channel.");
		const room = await Room.get(voice.id);
		if (!room || !(voice instanceof VoiceChannel)) return reply("This is not a managed voice room.");
		if (room.ownerId !== interaction.user.id) return reply("You are not the owner of this room.");

		const selectedUserId = interaction.values[0];
		if (!selectedUserId) return reply("Select a member to unmute.");
		const member = voice.members.get(selectedUserId);
		if (!member || member.voice.channelId !== voice.id) return reply("The selected member is not in your voice room.");

		try {
			await voice.permissionOverwrites.edit(member.id, { Speak: null }, {
				reason: `VoiceMaster room unmute by ${interaction.user.tag} (${interaction.user.id})`,
			});
			return reply("Removed the room mute from the selected member.");
		} catch (error) {
			console.error("[VoiceMaster Unmute Error]", error);
			return reply("Failed to unmute the selected member.");
		}
	}
}
