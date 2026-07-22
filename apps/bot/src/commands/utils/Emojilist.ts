import { EmbedBuilder } from "discord.js";
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
				embeds: [new EmbedBuilder().setColor(ctx.client.config.colors.main).setDescription("This server has no emojis.")],
			});
		}

		const embed = new EmbedBuilder()
			.setColor(ctx.client.config.colors.main)
			.setAuthor({ name: `Emoji List for ${ctx.guild.name}`, iconURL: ctx.guild.iconURL() ?? undefined })
			.setDescription(`Total Emojis: ${total}\nStatic: ${staticCount} | Animated: ${animatedCount}`)
			.setFooter({ text: `Requested by ${ctx.author?.tag}`, iconURL: ctx.author?.displayAvatarURL() })
			.setTimestamp();

		if (animatedCount > 0) {
			embed.addFields({ name: "Animated Emojis", value: animatedEmojis.length > 1000 ? "Too many to display." : animatedEmojis });
		}
		if (staticCount > 0) {
			embed.addFields({ name: "Static Emojis", value: staticEmojis.length > 1000 ? "Too many to display." : staticEmojis });
		}

		return ctx.editOrReply({ embeds: [embed] });
	}
}
