const test = require("node:test");
const assert = require("node:assert/strict");

const registry = require("../dist/config/commandRegistry.js");
const legacy = require("../dist/config/legacyCommandMap.js");

test("shipped command and legacy registries validate cleanly", () => {
	assert.deepEqual(registry.validateCommandRegistry(), []);
	assert.deepEqual(legacy.validateLegacyCommandMap(), []);
	assert.equal(registry.COMMAND_REGISTRY_BY_NAME.size, registry.COMMAND_REGISTRY.length);
	assert.equal(legacy.LEGACY_COMMANDS_BY_NAME.size, legacy.LEGACY_COMMANDS.length);
});

test("unique-map construction rejects normalized collisions instead of overwriting", () => {
	assert.throws(
		() => registry.buildUniqueRegistryMap([{ name: "Ping" }, { name: " ping " }], (value) => value.name, "test key"),
		/Duplicate test key after normalization/,
	);
});

test("command validation detects canonical, alias, and subcommand collisions deterministically", () => {
	const base = { ...registry.COMMAND_REGISTRY[0], legacyNames: [], subcommands: [] };
	const errors = registry.validateCommandRegistry([
		{ ...base, name: "alpha", legacyNames: ["BETA"], subcommands: ["show", "SHOW"] },
		{ ...base, name: "beta" },
		{ ...base, name: " alpha " },
	]);

	assert.deepEqual(errors, [...errors].sort());
	assert.ok(errors.some((error) => error.includes("Command name collision after normalization")));
	assert.ok(errors.some((error) => error.includes("Duplicate subcommand after normalization")));
});

test("legacy validation detects normalized duplicates and canonical-name collisions", () => {
	const first = { ...legacy.LEGACY_COMMANDS[0], legacyName: "help", replacement: "/help" };
	const second = { ...legacy.LEGACY_COMMANDS[0], legacyName: " HELP ", replacement: "/help" };
	const errors = legacy.validateLegacyCommandMap([first, second]);

	assert.deepEqual(errors, [...errors].sort());
	assert.ok(errors.some((error) => error.includes("Duplicate legacy mapping after normalization")));
	assert.ok(errors.some((error) => error.includes("Legacy command collides with canonical command")));
});
