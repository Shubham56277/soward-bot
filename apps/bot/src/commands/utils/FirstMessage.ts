import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
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

		const panel = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## [First Message in ${ctx.guild.name}](${msg.url})`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				[
					`**Content:** ${msg.content || "(no content)"}`,
					`**Author:** ${msg.author}`,
					`**Message ID:** ${msg.id}`,
					`**Created At:** <t:${Math.floor(msg.createdTimestamp / 1000)}:R>`,
					"",
					`-# Requested by ${ctx.author?.tag}`,
				].join("\n")
			));
		return ctx.editOrReply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
	}
}
