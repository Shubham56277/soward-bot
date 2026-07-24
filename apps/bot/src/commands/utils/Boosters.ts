import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Boosters extends Command {
	constructor() {
		super({
			name: "boosters",
			description: {
                content: "View all current server boosters",
                examples: ["boosters"],
                usage: "boosters",
			},
			category: "utils",
			cooldown: 10,
			args: false,
			permissions: {
				dev: false,
				client: ["EmbedLinks"],
				user: [],
			},
			slashCommand: false,
		});
	}

	public async run(ctx: Context): Promise<any> {
		const boosters = ctx.guild.members.cache.filter((member) => member.premiumSince);

		if (boosters.size === 0) {
			return ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> No current boosters found."))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const list = boosters.map((member) => `• ${member.user.tag} (${member}) - Boosting since <t:${Math.floor(member.premiumSinceTimestamp! / 1000)}:R>`).join("\n");

		const panel = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🚀 Current Server Boosters\n${list}\n\n-# Total Boosters: ${boosters.size}`));

		await ctx.sendMessage({ components: [panel], flags: MessageFlags.IsComponentsV2 });
	}
}
