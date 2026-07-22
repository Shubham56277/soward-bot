import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createMusicPanel } from "../../utils/musicPanel";
import { readMusicRecommendations } from "../../utils/musicRecommendations";

export default class Nowplaying extends Command {
	public constructor() {
		super({
			name: "nowplaying",
			description: { content: "Show the current song and music controls", examples: ["nowplaying"], usage: "nowplaying" },
			category: "music",
			aliases: ["nowp", "np"],
			cooldown: 5,
			args: false,
			vote: false,
			player: { voice: true, active: true },
			permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"], user: [] },
            slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const player = ctx.client.manager.getPlayer(ctx.guild.id);
		const track = player?.queue.current;
		if (!player || !track) return ctx.sendMessage("Nothing is playing right now");
		const recommendations = await readMusicRecommendations(ctx.client.redis, player, track);
		return ctx.sendMessage({
			components: [createMusicPanel(player, track, ctx.client.config.colors.main, ctx.client.user?.displayAvatarURL(), recommendations)],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
