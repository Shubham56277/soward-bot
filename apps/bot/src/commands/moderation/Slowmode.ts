import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Slowmode extends Command {
	public constructor() {
		super({
			name: "slowmode",
			description: { content: "Set the current channel slowmode", examples: ["slowmode 10"], usage: "slowmode <seconds>" },
			category: "moderation",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "ManageChannels"], user: ["ManageChannels"] },
			options: [{ name: "seconds", description: "Delay from 1 to 21600 seconds", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 21600 }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!("setRateLimitPerUser" in ctx.channel)) return ctx.sendMessage("Slowmode is not supported in this channel.");
		const seconds = ctx.options.getInteger("seconds", true, 0) ?? 0;
		if (seconds < 1 || seconds > 21_600) return ctx.sendMessage("Choose a delay from 1 to 21600 seconds. Use `unslowmode` to disable it.");
		await ctx.channel.setRateLimitPerUser(seconds, `Changed by ${ctx.author?.username ?? "a moderator"}`);
		return ctx.sendMessage(`Slowmode is now **${seconds} seconds**.`);
	}
}
