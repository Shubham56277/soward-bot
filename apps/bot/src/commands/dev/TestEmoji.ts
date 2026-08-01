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
				client: ["SendMessages", "UseExternalEmojis"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const channel = ctx.message?.channel as any;

		// Test emoji access in plain text
		await channel.send(
			"**Emoji Access Test (Application Emojis):**\n" +
			"settings: <:settings:1532834320132214878>\n" +
			"management: <:management:1532834395776483538>\n" +
			"community: <:community:1532834453003571210>\n" +
			"entertainment: <:entertainment:1532834484800585879>\n" +
			"utility: <:utility:1532834496586453173>"
		);

		// Build select menu using application emoji IDs
		const menu = new StringSelectMenuBuilder()
			.setCustomId("test_emoji_select")
			.setPlaceholder("Test emoji rendering");

		const option1 = new StringSelectMenuOptionBuilder()
			.setLabel("Settings")
			.setDescription("Application emoji test")
			.setValue("settings")
			.setDefault(false);
		// Write directly to .data.emoji to bypass potential setEmoji() issue
		(option1 as any).data.emoji = { id: "1532834320132214878", name: "settings", animated: false };

		const option2 = new StringSelectMenuOptionBuilder()
			.setLabel("Management")
			.setDescription("Application emoji test")
			.setValue("management")
			.setDefault(false);
		(option2 as any).data.emoji = { id: "1532834395776483538", name: "management", animated: false };

		const option3 = new StringSelectMenuOptionBuilder()
			.setLabel("No Emoji")
			.setDescription("Control option")
			.setValue("none")
			.setDefault(false);

		menu.addOptions(option1, option2, option3);

		// Log payload
		console.dir(menu.toJSON(), { depth: null });

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

		await channel.send({
			content: "**Select Menu Test (Application Emojis + direct .data.emoji):**",
			components: [row],
		});

		return;
	}
}
