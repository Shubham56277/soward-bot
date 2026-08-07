const test = require("node:test");
const assert = require("node:assert/strict");

// Keep this unit suite isolated from repository secrets and local configuration.
process.env.DOTENV_CONFIG_PATH = "__antinuke_test_no_env_file__";
Object.assign(process.env, {
	DISCORD_APP_TOKEN: "test-token",
	DISCORD_APP_CLIENT_ID: "123456789012345678",
	DEVELOPER_IDS: "[]",
	NODES: "[]",
	DATABASE_URI: "postgres://test:test@127.0.0.1:5432/test",
	COMMAND_LOG_WEBHOOK_URL: "",
	GUILD_CREATE_WEBHOOK_URL: "",
	GUILD_DELETE_WEBHOOK_URL: "",
	NO_PREFIX_WEBHOOK_URL: "",
	PREMIUM_WEBHOOK_URL: "",
	SHARD_WEBHOOK_URL: "",
	ERROR_WEBHOOK_URL: "",
	NEXT_PUBLIC_BASE_URL: "",
	IMAGIFY_API_URL: "",
	MEDIA_PROXY_URL: "",
	REDIS_URL: "",
	NODE_ENV: "development",
});

const state = require("../dist/modules/antiNukeState.js");
const { AntiNukeService } = require("../dist/modules/antinuke.js");
const { AntiNuke } = require("@repo/db");

function settings(overrides = {}) {
	const entry = (type) => ({ type, enabled: true, limit: 1, action: "ban" });
	return {
		enabled: true,
		trustedUsers: [],
		admin: null,
		channel: [entry("create"), entry("delete"), entry("update")],
		role: [entry("create"), entry("delete"), entry("update")],
		member: [entry("kick"), entry("ban"), entry("unban"), entry("update")],
		emoji: [entry("create"), entry("delete"), entry("update")],
		webhook: [entry("create"), entry("delete"), entry("update")],
		sticker: [entry("create"), entry("delete"), entry("update")],
		guild: [entry("update")],
		mention: true,
		gateKeeper: true,
		...overrides,
	};
}

test("disabled AntiNuke persists and displays every enforcement module off", () => {
	const current = settings();
	const patch = state.buildDisabledAntiNukePatch(current);
	assert.equal(patch.enabled, false);
	assert.equal(patch.mention, false);
	assert.equal(patch.gateKeeper, false);
	for (const key of state.ANTI_NUKE_MODULES) {
		assert.ok(patch[key].length > 0);
		assert.ok(patch[key].every((entry) => entry.enabled === false));
		assert.equal(state.moduleIsEnabled({ ...current, enabled: false }, key), false);
	}
});

test("canonical whitelist entries grant a full owner-like bypass", () => {
	const config = settings({ trustedUsers: ["123456789012345678", { id: "234567890123456789" }] });
	assert.equal(state.isAntiNukeBypassed(config, "345678901234567890", "456789012345678901", "123456789012345678"), true);
	assert.equal(state.isAntiNukeBypassed(config, "345678901234567890", "456789012345678901", "234567890123456789"), true);
	assert.equal(state.isAntiNukeBypassed(config, "345678901234567890", "456789012345678901", "567890123456789012"), false);
	assert.deepEqual(state.normalizeTrustedUsers(config.trustedUsers), [
		{ id: "123456789012345678" },
		{ id: "234567890123456789" },
	]);
});

test("guild invalidation clears active config and action caches only for that guild", () => {
	const configs = new Map([
		["123456789012345678", settings()],
		["234567890123456789", settings()],
	]);
	const actions = new Map([
		["123456789012345678:user:channelCreate", [1, Date.now()]],
		["123456789012345678:user:roleCreate", [1, Date.now()]],
		["234567890123456789:user:channelCreate", [1, Date.now()]],
	]);

	state.clearLocalAntiNukeCaches("123456789012345678", configs, actions);
	assert.equal(configs.has("123456789012345678"), false);
	assert.equal(configs.has("234567890123456789"), true);
	assert.deepEqual([...actions.keys()], ["234567890123456789:user:channelCreate"]);
});

test("whitelist target parsing accepts mentions/raw snowflakes and rejects malformed input", () => {
	assert.equal(state.parseDiscordUserId("<@123456789012345678>"), "123456789012345678");
	assert.equal(state.parseDiscordUserId("<@!123456789012345678>"), "123456789012345678");
	assert.equal(state.parseDiscordUserId("123456789012345678"), "123456789012345678");
	assert.equal(state.parseDiscordUserId("not-a-user"), null);
	assert.equal(state.parseDiscordUserId("123"), null);
});

test("runtime invalidation deletes Redis c:<guildId> and active action state", async () => {
	const deleted = [];
	const client = {
		user: { id: "456789012345678901" },
		logger: { error: () => {} },
		redis: {
			del: async (...keys) => { deleted.push(...keys); return keys.length; },
			scan: async () => ["0", []],
			unlink: async () => 0,
		},
	};
	const service = new AntiNukeService(client);
	const guildId = "123456789012345678";
	service.syncGuildConfig(guildId, settings({ guildId }));
	service.actions.set(`${guildId}:user:channelCreate`, [1, Date.now() + 1000]);

	await service.invalidateGuild(guildId);
	assert.equal(service.configs.has(guildId), false);
	assert.equal(service.actions.size, 0);
	assert.ok(deleted.includes(`c:${guildId}`));
});

test("punishment refreshes persisted state and atomically suppresses duplicates", async () => {
	const originalGet = AntiNuke.get;
	const lockCalls = [];
	let bans = 0;
	const client = {
		user: { id: "456789012345678901" },
		logger: { error: () => {} },
		redis: {
			set: async (...args) => { lockCalls.push(args); return "OK"; },
			del: async () => 0,
			scan: async () => ["0", []],
			unlink: async () => 0,
		},
	};
	const guild = {
		id: "123456789012345678",
		ownerId: "345678901234567890",
		members: {
			ban: async () => { bans++; },
			kick: async () => {},
			cache: new Map(),
			fetch: async () => null,
		},
	};
	const service = new AntiNukeService(client);

	try {
		AntiNuke.get = async () => settings({ enabled: false });
		assert.equal(await service.punishUser(guild, "567890123456789012", "ban", "disabled"), false);
		AntiNuke.get = async () => settings({ trustedUsers: [{ id: "567890123456789012" }] });
		assert.equal(await service.punishUser(guild, "567890123456789012", "ban", "trusted"), false);
		assert.equal(lockCalls.length, 0);
		assert.equal(bans, 0);

		AntiNuke.get = async () => settings();
		assert.equal(await service.punishUser(guild, "567890123456789012", "ban", "first"), true);
		assert.equal(await service.punishUser(guild, "567890123456789012", "ban", "duplicate"), false);
		assert.equal(bans, 1);
		assert.deepEqual(lockCalls[0].slice(1), ["1", "EX", 20, "NX"]);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("safe enable defaults and whitelist mutations stay canonical", () => {
	const defaults = state.buildSafeDefaultAntiNukePatch();
	assert.equal(defaults.enabled, true);
	assert.equal(defaults.mention, true);
	assert.equal(defaults.gateKeeper, true);
	for (const key of state.ANTI_NUKE_MODULES) {
		assert.ok(defaults[key].length > 0);
		assert.ok(defaults[key].every((entry) => entry.enabled && entry.limit === 1 && entry.action === "ban"));
	}

	const first = "678901234567890123";
	const second = "789012345678901234";
	let users = state.addTrustedUser([first, { id: first }], second);
	assert.deepEqual(users, [{ id: first }, { id: second }]);
	users = state.addTrustedUser(users, second);
	assert.deepEqual(users, [{ id: first }, { id: second }]);
	users = state.removeTrustedUser(users, first);
	assert.deepEqual(users, [{ id: second }]);
	users = state.removeTrustedUser(users, second);
	assert.deepEqual(users, []);

	const model = new AntiNuke("123456789012345678", {
		trustedUsers: [first, { id: second }, { id: first }, "invalid"],
	});
	assert.deepEqual(model.trustedUsers, [{ id: first }, { id: second }]);
});

test("disabled central paths do not count actions or clean up channels", async () => {
	const originalGet = AntiNuke.get;
	let increments = 0;
	let deletes = 0;
	const client = {
		user: { id: "456789012345678901" },
		logger: { error: () => {} },
		rest: { delete: async () => { deletes++; } },
		redis: {
			eval: async () => { increments++; return 1; },
			del: async () => 0,
			scan: async () => ["0", []],
			unlink: async () => 0,
		},
	};
	const guild = { id: "123456789012345678", ownerId: "345678901234567890" };
	const service = new AntiNukeService(client);

	try {
		AntiNuke.get = async () => settings({ enabled: false });
		const action = settings().channel[0];
		assert.equal(await service.trackAction(guild, "890123456789012345", "channelCreate", action), false);
		assert.equal(await service.cleanupChannel(guild, "890123456789012345", "901234567890123456"), false);
		assert.equal(increments, 0);
		assert.equal(deletes, 0);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("channel cleanup only deletes the explicit triggering channel", async () => {
	const originalGet = AntiNuke.get;
	const deleted = [];
	const client = {
		user: { id: "456789012345678901" },
		logger: { error: () => {} },
		rest: { delete: async (route) => { deleted.push(route); } },
		redis: {},
	};
	const guild = { id: "123456789012345678", ownerId: "345678901234567890" };
	const service = new AntiNukeService(client);

	try {
		AntiNuke.get = async () => settings();
		assert.equal(await service.cleanupChannel(guild, "890123456789012345", "901234567890123456"), true);
		assert.equal(deleted.length, 1);
		assert.match(deleted[0], /901234567890123456/);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("distributed punishment lock is acquired before either process punishes", async () => {
	const originalGet = AntiNuke.get;
	let redisLocked = false;
	let redisLockCalls = 0;
	let bans = 0;
	const redis = {
		set: async () => {
			redisLockCalls++;
			if (redisLocked) return null;
			redisLocked = true;
			return "OK";
		},
		del: async () => 0,
		scan: async () => ["0", []],
		unlink: async () => 0,
	};
	const makeClient = () => ({ user: { id: "456789012345678901" }, logger: { error: () => {} }, redis });
	const guild = {
		id: "123456789012345678",
		ownerId: "345678901234567890",
		members: { ban: async () => { bans++; }, kick: async () => {}, cache: new Map(), fetch: async () => null },
	};

	try {
		AntiNuke.get = async () => settings();
		const firstProcess = new AntiNukeService(makeClient());
		const secondProcess = new AntiNukeService(makeClient());
		// Separate local lock sets model independent bot processes sharing Redis.
		firstProcess.locks = new Set();
		secondProcess.locks = new Set();
		const results = await Promise.all([
			firstProcess.punishUser(guild, "901234567890123456", "ban", "process one"),
			secondProcess.punishUser(guild, "901234567890123456", "ban", "process two"),
		]);
		assert.deepEqual(results.sort(), [false, true]);
		assert.equal(redisLockCalls, 2);
		assert.equal(bans, 1);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("Redis outage uses one process-local punishment lock before side effects", async () => {
	const originalGet = AntiNuke.get;
	let bans = 0;
	const redis = {
		set: async () => { throw new Error("redis unavailable"); },
		del: async () => 0,
		scan: async () => ["0", []],
		unlink: async () => 0,
	};
	const makeClient = () => ({ user: { id: "456789012345678901" }, logger: { error: () => {} }, redis });
	const guild = {
		id: "123456789012345678",
		ownerId: "345678901234567890",
		members: { ban: async () => { bans++; }, kick: async () => {}, cache: new Map(), fetch: async () => null },
	};

	try {
		AntiNuke.get = async () => settings();
		const results = await Promise.all([
			new AntiNukeService(makeClient()).punishUser(guild, "912345678901234567", "ban", "fallback one"),
			new AntiNukeService(makeClient()).punishUser(guild, "912345678901234567", "ban", "fallback two"),
		]);
		assert.deepEqual(results.sort(), [false, true]);
		assert.equal(bans, 1);
	} finally {
		AntiNuke.get = originalGet;
	}
});