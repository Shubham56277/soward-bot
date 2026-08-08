import { ButtonInteraction, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, VoiceChannel } from "discord.js";
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
			const avatar = owner?.user.displayAvatarURL() ?? "https://cdn.discordapp.com/embed/avatars/0.png";

			const body = new TextDisplayBuilder().setContent(
				[
					`Owner: ${owner?.user.username} (\`${owner?.id}\`)`,
					`Locked: ${voice.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has("Connect") ? this.client.config.emojis.on : this.client.config.emojis.on}`,
					`Created: <t:${Math.floor(voice.createdAt.getTime() / 1000)}:R>`,
					`Bitrate: ${voice.bitrate / 1000}kbps`,
					`Connected: \`${voice.members.size}\``,
				].join("\n"),
			);

			const container = new ContainerBuilder()
				.addSectionComponents(
					new SectionBuilder()
						.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${owner?.user.username}**'s room`))
						.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription(`${owner?.user.username} avatar`)),
				)
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(body);

			return interaction.reply({
				components: [container],
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			});
		}
	}
}
