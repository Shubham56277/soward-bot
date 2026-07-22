import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class FirstMessage extends Command {
	constructor() {
		super({
			name: "firstmessage",
			description: {
				content: "First message of this channel.",
				examples: ["firstmessage"],
				usage: "firstmessage",
			},
			category: "utils",
			aliases: ["firstmsg"],
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
			slashCommand: true,
			options: [],
		});
	}
	public async run(ctx: Context): Promise<any> {
		const fetchMessages = await ctx.channel.messages.fetch({
			after: "0",
			limit: 1,
		});

		const msg = fetchMessages.first();
		if (!msg) return ctx.sendMessage("No message found.");

		const msgEmbed = new EmbedBuilder()
			.setTitle(`First Message in ${ctx.guild.name}`)
			.setURL(msg.url)
			.setDescription(`Content: ${msg.content}`)
			.setColor(ctx.client.config.colors.main)
			.setFields([
				{ name: "Author", value: `${msg.author}` },
				{ name: "Message ID", value: `${msg.id}` },
				{ name: "Created At", value: `<t:${Math.floor(msg.createdTimestamp / 1000)}:R>` },
			])
			.setFooter({ text: `Requested by ${ctx.author?.tag}`, iconURL: ctx.author?.displayAvatarURL() })
			.setTimestamp();
		return ctx.editOrReply({ embeds: [msgEmbed] });
	}
}
