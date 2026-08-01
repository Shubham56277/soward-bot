import {
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

/**
 * Temporary test command to isolate emoji rendering in select menus.
 * Tests: custom static emoji, animated emoji, unicode emoji, no emoji.
 * Also tests sending WITHOUT Components V2 (plain ActionRow).
 */
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
		const menu = new StringSelectMenuBuilder()
			.setCustomId("test_emoji_select")
			.setPlaceholder("Test emoji rendering");

		// Option 1: Static custom emoji (application emoji - settings)
		const opt1 = new StringSelectMenuOptionBuilder()
			.setLabel("Static Custom Emoji")
			.setDescription("Application emoji: settings")
			.setValue("static_custom")
			.setEmoji({ id: "1532834320132214878", name: "settings", animated: false });

		// Option 2: Animated custom emoji (dot)
		const opt2 = new StringSelectMenuOptionBuilder()
			.setLabel("Animated Custom Emoji")
			.setDescription("Animated emoji: dot")
			.setValue("animated_custom")
			.setEmoji({ id: "1532821300773388299", name: "dot", animated: true });

		// Option 3: Unicode emoji
		const opt3 = new StringSelectMenuOptionBuilder()
			.setLabel("Unicode Emoji")
			.setDescription("Standard unicode emoji")
			.setValue("unicode")
			.setEmoji({ name: "⚙️" });

		// Option 4: No emoji
		const opt4 = new StringSelectMenuOptionBuilder()
			.setLabel("No Emoji")
			.setDescription("This option has no emoji")
			.setValue("none");

		menu.addOptions(opt1, opt2, opt3, opt4);

		// Log the serialized payload
		const serialized = menu.toJSON();
		console.log("[TestEmoji] Full serialized payload:", JSON.stringify(serialized, null, 2));

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

		// Send as a NORMAL message (no Components V2, no ContainerBuilder)
		await (ctx.message?.channel as any).send({
			content: "**Emoji Test** — Check which emojis render below:",
			components: [row],
		});

		return;
	}
}
