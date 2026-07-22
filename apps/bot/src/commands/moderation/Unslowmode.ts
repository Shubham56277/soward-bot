import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Unslowmode extends Command {
	public constructor() {
		super({
			name: "unslowmode",
			description: { content: "Disable slowmode in the current channel", examples: ["unslowmode"], usage: "unslowmode" },
			category: "moderation",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "ManageChannels"], user: ["ManageChannels"] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!("setRateLimitPerUser" in ctx.channel)) return ctx.sendMessage("Slowmode is not supported in this channel.");
		await ctx.channel.setRateLimitPerUser(0, `Disabled by ${ctx.author?.username ?? "a moderator"}`);
		return ctx.sendMessage("Slowmode is disabled.");
	}
}
