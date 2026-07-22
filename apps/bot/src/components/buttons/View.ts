import { ButtonInteraction, EmbedBuilder, MessageFlags, VoiceChannel } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { Room } from "@repo/db";

export default class View extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "voice-view",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		if (!interaction.guild) return;
		const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return;
		const room = await Room.get(voice.id);
		if (!room) return;
		if (voice instanceof VoiceChannel) {
			const owner = interaction.guild?.members.cache.get(room.ownerId);
			const embed = new EmbedBuilder()
				.setAuthor({
					name: `${owner?.user.username}`,
					iconURL: owner?.user.avatarURL() || undefined,
				})
                .setColor(this.client.config.colors.main)
				.setDescription(
					[
						`**${owner?.user.username}**'s room`,
						"",
						`Owner: ${owner?.user.username} (\`${owner?.id}\`)`,
						`Locked: ${voice.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has("Connect") ? this.client.config.emojis.on : this.client.config.emojis.on}`,
						`Created: <t:${Math.floor(voice.createdAt.getTime() / 1000)}:R>`,
						`Bitrate: ${voice.bitrate / 1000}kbps`,
						`Connected: \`${voice.members.size}\``,
					].join("\n"),
				);

			return interaction.reply({
				embeds: [embed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
