import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Emojilist extends Command {
	constructor() {
		super({
			name: "emojilist",
			description: {
				content: "List of available emojis in this server",
				examples: ["emojilist"],
				usage: "emojilist",
			},
			category: 'utils',
			aliases: ["emojis"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: false,
			options: []
		});
	}
	public async run(ctx: Context): Promise<any> {
		let staticEmojis = "";
		let animatedEmojis = "";
		let staticCount = 0;
		let animatedCount = 0;

		for (const emoji of ctx.guild.emojis.cache.values()) {
			if (emoji.animated) {
				animatedCount++;
				animatedEmojis += `${emoji.toString()} `;
			} else {
				staticCount++;
				staticEmojis += `${emoji.toString()} `;
			}
		}

		const total = staticCount + animatedCount;

		if (total === 0) {
			return ctx.editOrReply({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("This server has no emojis."))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const lines = [
			`**Emoji List for ${ctx.guild.name}**`,
			`Total Emojis: ${total} | Static: ${staticCount} | Animated: ${animatedCount}`,
		];
		if (animatedCount > 0) {
			lines.push("", "**Animated Emojis:**", animatedEmojis.length > 1000 ? "Too many to display." : animatedEmojis);
		}
		if (staticCount > 0) {
			lines.push("", "**Static Emojis:**", staticEmojis.length > 1000 ? "Too many to display." : staticEmojis);
		}
		lines.push("", `-# Requested by ${ctx.author?.tag}`);

		const panel = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));

		return ctx.editOrReply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
	}
}
