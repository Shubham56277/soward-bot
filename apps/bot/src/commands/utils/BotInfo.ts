import { MessageFlags, version as discordJsVersion } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class BotInfo extends Command {
	public constructor() {
		super({
			name: "botinfo",
			description: { content: "Show the bot identity and software build", examples: ["botinfo"], usage: "botinfo" },
			category: "utils",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		const bot = ctx.client.user!;
		return ctx.sendMessage({
			components: [createInfoPanel(ctx, `${bot.username} Information`, "Identity and software build.", [
				["Application", `${bot.username} (\`${bot.id}\`)`],
				["Created", `<t:${Math.floor(bot.createdTimestamp / 1_000)}:F>`],
				["Commands", ctx.client.commands.size.toLocaleString()],
				["Node.js", process.version],
				["Discord.js", `v${discordJsVersion}`],
			])],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
