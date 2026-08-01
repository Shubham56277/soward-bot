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
		// Approach: Build the select menu using RAW API option objects
		// This bypasses any discord.js builder that might strip emoji
		const menu = new StringSelectMenuBuilder()
			.setCustomId("test_emoji_select")
			.setPlaceholder("Test emoji rendering")
			.addOptions(
				{
					label: "Static Custom Emoji",
					description: "Application emoji: settings",
					value: "static_custom",
					emoji: { id: "1532834320132214878", name: "settings", animated: false },
				},
				{
					label: "Animated Custom Emoji",
					description: "Animated emoji: dot",
					value: "animated_custom",
					emoji: { id: "1532821300773388299", name: "dot", animated: true },
				},
				{
					label: "Unicode Emoji",
					description: "Standard unicode emoji",
					value: "unicode",
					emoji: { name: "⚙️" },
				},
				{
					label: "No Emoji",
					description: "This option has no emoji",
					value: "none",
				},
			);

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
