import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class Users extends Command {
	public constructor() {
		super({
			name: "users",
			description: { content: "Show the bot's visible user and server totals", examples: ["users"], usage: "users" },
			category: "utils",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		const shards = await ctx.client.cluster.broadcastEval((client) => ({
			guilds: client.guilds.cache.size,
			users: client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0),
		})).catch(() => [{ guilds: ctx.client.guilds.cache.size, users: ctx.client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0) }]);
		const totals = shards.reduce((sum, item) => ({ guilds: sum.guilds + item.guilds, users: sum.users + item.users }), { guilds: 0, users: 0 });
		return ctx.sendMessage({
			components: [createInfoPanel(ctx, "Network", "Visible community totals.", [
				["Users", totals.users.toLocaleString()],
				["Servers", totals.guilds.toLocaleString()],
			])],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
