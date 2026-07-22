import { MessageFlags, TextChannel } from "discord.js";
import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { createMusicPanel } from "../../utils/musicPanel";
import { getMusicRecommendations } from "../../utils/musicRecommendations";
import { startMusicProgressUpdater } from "../../utils/musicProgressUpdater";

export default class TrackStart extends Event {
	public constructor(client: BaseClient) {
		super(client, { event: "trackStart" });
	}

	public async execute(): Promise<void> {
		startMusicProgressUpdater(this.client);
		this.client.manager.on("trackStart", async (player, track) => {
			const guild = this.client.guilds.cache.get(player.guildId);
			if (!guild || !player.textChannelId || !track) return;
			const channel = guild.channels.cache.get(player.textChannelId) as TextChannel;
			if (!channel?.isTextBased()) return;

			const message = await channel.send({
				components: [createMusicPanel(player, track, this.client.config.colors.main, this.client.user?.displayAvatarURL())],
				flags: MessageFlags.IsComponentsV2,
			});
			player.set("messageId", message.id);

			const recommendations = await getMusicRecommendations(this.client.redis, player, track);
			if (player.queue.current?.info.identifier !== track.info.identifier || !recommendations.length) return;
			await message.edit({
				components: [createMusicPanel(player, track, this.client.config.colors.main, this.client.user?.displayAvatarURL(), recommendations)],
			}).catch(() => undefined);
		});
	}
}
