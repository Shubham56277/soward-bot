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

		// DIAGNOSTIC: Check what setEmoji actually does on this runtime
		const testOpt = new StringSelectMenuOptionBuilder()
			.setLabel("Diagnostic")
			.setValue("diag")
			.setDefault(false);

		// Log data BEFORE setEmoji
		console.log("[TestEmoji] data BEFORE setEmoji:", JSON.stringify((testOpt as any).data));

		testOpt.setEmoji({ id: "1532834320132214878", name: "settings", animated: false });

		// Log data AFTER setEmoji
		console.log("[TestEmoji] data AFTER setEmoji:", JSON.stringify((testOpt as any).data));

		// Log toJSON
		console.log("[TestEmoji] toJSON:", JSON.stringify(testOpt.toJSON()));

		// Also check: what does the builders version say?
		try {
			const buildersPath = require.resolve("@discordjs/builders/package.json");
			const buildersPkg = require(buildersPath);
			console.log("[TestEmoji] @discordjs/builders version:", buildersPkg.version);
		} catch (e) {
			console.log("[TestEmoji] Could not resolve builders version:", e);
		}

		try {
			const djsPath = require.resolve("discord.js/package.json");
			const djsPkg = require(djsPath);
			console.log("[TestEmoji] discord.js version:", djsPkg.version);
		} catch (e) {
			console.log("[TestEmoji] Could not resolve djs version:", e);
		}

		// Now build and send the menu
		const menu = new StringSelectMenuBuilder()
			.setCustomId("test_emoji_select")
			.setPlaceholder("Test emoji rendering")
			.setMinValues(1)
			.setMaxValues(1);

		const opt1 = new StringSelectMenuOptionBuilder()
			.setLabel("With Emoji")
			.setDescription("Should have settings emoji")
			.setValue("with_emoji")
			.setDefault(false);
		opt1.setEmoji({ id: "1532834320132214878", name: "settings", animated: false });

		const opt2 = new StringSelectMenuOptionBuilder()
			.setLabel("No Emoji")
			.setDescription("Control - no emoji")
			.setValue("no_emoji")
			.setDefault(false);

		menu.addOptions(opt1, opt2);

		console.log("[TestEmoji] FULL menu.toJSON():", JSON.stringify(menu.toJSON(), null, 2));

		const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

		await channel.send({
			content: "**Emoji Diagnostic Test**\nCheck PM2 logs for data BEFORE/AFTER setEmoji",
			components: [row],
		});

		return;
	}
}
