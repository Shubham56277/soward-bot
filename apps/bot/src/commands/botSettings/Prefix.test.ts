import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationCommandOptionType } from "discord.js";
import { HELP_CATEGORIES } from "../../config/helpArchitecture";
import Help, { formatCategoryCommand } from "../utils/Help";
import NoPrefix from "./NoPrefix";
import Prefix, { normalizePrefixAction } from "./Prefix";

describe("Prefix command metadata and compatibility", () => {
	it("registers canonical slash list metadata without show", () => {
		const subcommands = new Prefix().options
			.filter((option) => option.type === ApplicationCommandOptionType.Subcommand)
			.map((option) => option.name);

		assert.ok(subcommands.includes("list"));
		assert.ok(!subcommands.includes("show"));
	});

	it("normalizes legacy show and canonical list to the same action", () => {
		assert.equal(normalizePrefixAction("list"), "list");
		assert.equal(normalizePrefixAction("LIST"), "list");
		assert.equal(normalizePrefixAction("show"), "list");
		assert.equal(normalizePrefixAction("SHOW"), "list");
	});
});

describe("Bot Settings prefix help architecture", () => {
	it("contains every canonical prefix and no-prefix entry", () => {
		const commands = HELP_CATEGORIES.find((category) => category.key === "bot-settings")
			?.features.flatMap((feature) => feature.groups)
			.find((group) => group.heading === "Prefixes")?.commands;

		assert.deepEqual(commands, [
			"prefix", "prefix list", "prefix set !", "prefix add ?", "prefix remove ?", "prefix reset",
			"noprefix", "noprefix enable", "noprefix disable",
		]);
		assert.ok(!commands?.includes("prefix show"));
	});
});

describe("Help category command formatting", () => {
	it("uses the active prefix and exact premium marker placement", () => {
		assert.equal(formatCategoryCommand("?", "prefix list"), "**`?prefix list`**");
		assert.equal(formatCategoryCommand("?", "noprefix enable", true), "**`❄ ?noprefix enable`**");
		assert.equal(formatCategoryCommand("!", "noprefix disable", true), "**`❄ !noprefix disable`**");
	});

	it("preserves arbitrary configured prefixes for every category entry", () => {
		for (const prefix of ["!", "??", ".", "$", "elf "]) {
			assert.equal(formatCategoryCommand(prefix, "prefix reset"), `**\`${prefix}prefix reset\`**`);
		}
	});
});

describe("Root command routes", () => {
	async function assertDelegatesToHelp(command: { run(ctx: any): Promise<any> }, ctx: any, commandName: string): Promise<void> {
		const original = Help.prototype.showCommand;
		const expected = { commandName };
		let receivedContext: any;
		let receivedName: string | undefined;

		Help.prototype.showCommand = async (actualContext, actualName) => {
			receivedContext = actualContext;
			receivedName = actualName;
			return expected;
		};

		try {
			assert.equal(await command.run(ctx), expected);
			assert.equal(receivedContext, ctx);
			assert.equal(receivedName, commandName);
		} finally {
			Help.prototype.showCommand = original;
		}
	}

	it("routes prefix without a subcommand through Help command details", async () => {
		const ctx = { options: { getSubCommand: () => undefined } };
		await assertDelegatesToHelp(new Prefix(), ctx, "prefix");
	});

	it("routes noprefix without a subcommand through Help command details", async () => {
		const ctx = { args: [] };
		await assertDelegatesToHelp(new NoPrefix(), ctx, "noprefix");
	});
});