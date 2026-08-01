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
				content: "Test emoji access and select menu rendering",
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

		// Step 1: Test emoji ACCESS by sending as plain text
		await channel.send(
			"**Emoji Access Test:**\n" +
			"settings: <:settings:1532817505423327312>\n" +
			"Mangement: <:Mangement:1532813659905196326>\n" +
			"community: <:community:1532819061426094203>\n" +
			"entertainment: <:entertainment:1532819510854156390>\n" +
			"utility: <:utility:1532817994726637847>\n" +
			"If any shows as raw text, the bot cannot access that emoji."
		);

		// Step 2: Build select menu with StringSelectMenuOptionBuilder + setEmoji
		const menu = new StringSelectMenuBuilder()
			.setCustomId("test_emoji_select")
			.setPlaceholder("Test emoji rendering");

		const option = new StringSelectMenuOptionBuilder()
			.setLabel("Settings Test")
			.setDescription("Guild emoji: settings")
			.setValue("settings_test")
			.setDefault(false);

		option.setEmoji({ id: "1532817505423327312", name: "settings", animated: false });

		const option2 = new StringSelectMenuOptionBuilder()
			.setLabel("Management Test")
			.setDescription("Guild emoji: Mangement")
			.setValue("management_test")
			.setDefault(false);

		option2.setEmoji({ id: "1532813659905196326", name: "Mangement", animated: false });

		const option3 = new StringSelectMenuOptionBuilder()
			.setLabel("No Emoji")
			.setDescription("Control option without emoji")
			.setValue("none")
			.setDefault(false);

		menu.addOptions(option, option2, option3);

		// Step 3: Log FULL serialized payload with depth
		console.dir(menu.toJSON(), { depth: null });

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

		await channel.send({
			content: "**Select Menu Emoji Test:**",
			components: [row],
		});

		return;
	}
}
