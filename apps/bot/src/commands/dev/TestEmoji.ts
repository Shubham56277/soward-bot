import {
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class TestEmoji extends Command {
	public constructor() {
		super({
			name: "testemoji",
			description: {
				content: "Test emoji rendering in select menus",
				examples: ["testemoji"],
				usage: "testemoji",
			},
			category: "dev",
			aliases: [],
			cooldown: 3,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: true,
				client: ["SendMessages"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const channel = ctx.message?.channel as any;

		const option = new StringSelectMenuOptionBuilder()
			.setLabel("Bot Settings")
			.setDescription("Test custom emoji")
			.setValue("bot-settings")
			.setEmoji("1532834320132214878");

		const menu = new StringSelectMenuBuilder()
			.setCustomId("emoji_test")
			.setPlaceholder("Select a module")
			.addOptions(option);

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

		console.dir(row.toJSON(), { depth: null });

		await channel.send({
			content: "**Isolated Emoji Test:**",
			components: [row],
		});

		return;
	}
}
