import { MessageFlags, TextChannel } from "discord.js";
import BaseClient from "../base/Client";
import { createMusicPanel } from "./musicPanel";
import { readMusicRecommendations } from "./musicRecommendations";

const UPDATE_INTERVAL_MS = 15_000;
const startedClients = new WeakSet<BaseClient>();

export function startMusicProgressUpdater(client: BaseClient): void {
	if (startedClients.has(client)) return;
	startedClients.add(client);

	let updating = false;
	const timer = setInterval(async () => {
		if (updating) return;
		updating = true;
		try {
			for (const player of client.manager.players.values()) {
				const track = player.queue.current;
				if (!track || track.info.isStream || player.paused || !player.textChannelId) continue;
				const messageId = player.get<string | undefined>("messageId");
				if (!messageId) continue;

				const guild = client.guilds.cache.get(player.guildId);
				const channel = guild?.channels.cache.get(player.textChannelId) as TextChannel | undefined;
				if (!channel?.isTextBased()) continue;

				const message = await channel.messages.fetch(messageId).catch(() => null);
				if (!message) continue;
				const recommendations = await readMusicRecommendations(client.redis, player, track);
				await message.edit({
					components: [createMusicPanel(player, track, client.config.colors.main, client.user?.displayAvatarURL(), recommendations)],
					flags: MessageFlags.IsComponentsV2,
				}).catch(() => undefined);
			}
		} finally {
			updating = false;
		}
	}, UPDATE_INTERVAL_MS);
	timer.unref();
}
