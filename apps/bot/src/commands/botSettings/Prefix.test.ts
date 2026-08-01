import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationCommandOptionType } from "discord.js";
import { HELP_CATEGORIES } from "../../config/helpArchitecture";
import { formatCategoryCommand } from "../utils/Help";
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
