import { GuildMember, MessageFlags, UserSelectMenuInteraction, VoiceChannel } from "discord.js";
import BaseClient from "../../base/Client";
import { Room } from "@repo/db";
import Menu from "../../abstract/Menu";

export default class Disconnect extends Menu {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-disconnect-menu",
		});
	}

	public async execute(interaction: UserSelectMenuInteraction): Promise<any> {
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

		const allMembers = voice.members;
		if (voice instanceof VoiceChannel) {
			const userId = interaction.values[0];
			const member = allMembers.find((member) => member.id === userId);
            if (!member) {
                return interaction.reply({
                    content: "Please select that user is in the room.",
                    flags: MessageFlags.Ephemeral,
                });
            }
			disconnectMember(member!, voice.id);
			return interaction.reply({
				content: "Disconnected the user.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

function disconnectMember(member: GuildMember, id?: string) {
	if (member.voice?.channelId && ((id && member.voice.channelId === id) || !id)) {
		return member.voice.disconnect().catch(() => {});
	}
}
