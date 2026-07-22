import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";
import { TimeFormat } from "../../utils/timeFormat";

export default class Uptime extends Command {
	public constructor() {
		super({
			name: "uptime",
			description: { content: "Show how long the bot has been online", examples: ["uptime"], usage: "uptime" },
			category: "utils",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		return ctx.sendMessage({
			components: [createInfoPanel(ctx, "Uptime", "Current process availability.", [
				["Online", TimeFormat.toHumanize(ctx.client.uptime || 0)],
				["Shard", `${ctx.guild.shardId + 1}`],
			])],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
