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

const fs = require("node:fs");
const path = require("node:path");
const state = require("../dist/modules/antiNukeState.js");
const ui = require("../dist/modules/antiNukeUi.js");
const { AntiNukeService, INFINITE_VOID_THRESHOLD, INFINITE_VOID_WINDOW_MS } = require("../dist/modules/antinuke.js");
const { AntiNuke } = require("@repo/db");

function settings(overrides = {}) {
	const entry = (type) => ({ type, enabled: true, limit: 1, action: "ban" });
	return {
		enabled: true,
		trustedUsers: [],
		admin: null,
		channel: [entry("create"), entry("delete"), entry("update")],
		role: [entry("create"), entry("delete"), entry("update")],
		member: [entry("kick"), entry("ban"), entry("unban"), entry("update"), { type: "infiniteVoid", enabled: true, limit: 50, action: "ban" }],
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
		const normalEntries = defaults[key].filter((entry) => entry.type !== "infiniteVoid");
		assert.ok(normalEntries.every((entry) => entry.enabled && entry.limit === 1 && entry.action === "ban"));
	}
	const infiniteVoid = defaults.member.find((entry) => entry.type === "infiniteVoid");
	assert.deepEqual(infiniteVoid, { type: "infiniteVoid", enabled: true, limit: 50, action: "ban" });

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


function createInfiniteVoidRedis({ failEval = false, failRevoke = false } = {}) {
	const sortedSets = new Map();
	const strings = new Map();
	const locks = new Set();
	let evalCalls = 0;
	return {
		sortedSets,
		strings,
		get evalCalls() { return evalCalls; },
		async eval(script, _keyCount, key, ...args) {
			evalCalls++;
			if (failEval) throw new Error("redis unavailable");
			if (script.includes("ZREMRANGEBYSCORE")) {
				const [cutoffRaw, scoreRaw, auditId, , maxRaw] = args;
				const cutoff = Number(cutoffRaw);
				const score = Number(scoreRaw);
				const max = Number(maxRaw);
				const entries = sortedSets.get(key) ?? new Map();
				for (const [id, value] of entries) if (value <= cutoff) entries.delete(id);
				const added = entries.has(auditId) ? 0 : 1;
				if (added) entries.set(auditId, score);
				if (entries.size > max) {
					const oldest = [...entries.entries()].sort((a, b) => a[1] - b[1]);
					for (const [id] of oldest.slice(0, entries.size - max)) entries.delete(id);
				}
				sortedSets.set(key, entries);
				return [added, entries.size];
			}
			if (script.includes("cjson.decode")) {
				if (failRevoke) throw new Error("extra owner store unavailable");
				const raw = strings.get(key);
				if (!raw) return 0;
				const owners = JSON.parse(raw);
				const kept = owners.filter((owner) => owner.userId !== args[0]);
				strings.set(key, JSON.stringify(kept));
				return owners.length - kept.length;
			}
			throw new Error("unexpected script");
		},
		async set(key, value, ...args) {
			if (args.includes("NX")) {
				if (locks.has(key)) return null;
				locks.add(key);
				return "OK";
			}
			strings.set(key, value);
			return "OK";
		},
		async get(key) { return strings.get(key) ?? null; },
		async del(...keys) { for (const key of keys) strings.delete(key); return keys.length; },
		async scan() { return ["0", []]; },
		async unlink() { return 0; },
	};
}

function createInfiniteVoidRuntime(redis, executorId = "567890123456789012") {
	let bans = 0;
	const member = {
		id: executorId,
		bannable: true,
		moderatable: true,
		roles: { cache: new Map(), remove: async () => {} },
		timeout: async () => {},
	};
	const guild = {
		id: "123456789012345678",
		ownerId: "345678901234567890",
		members: {
			cache: new Map([[executorId, member]]),
			fetch: async () => member,
			ban: async () => { bans++; },
		},
	};
	const client = {
		user: { id: "456789012345678901" },
		logger: { error: () => {}, warn: () => {}, info: () => {} },
		redis,
	};
	return { client, guild, get bans() { return bans; } };
}

test("Infinite Void keeps a rolling Redis window and deduplicates audit entries", async () => {
	const originalGet = AntiNuke.get;
	const redis = createInfiniteVoidRedis();
	const runtime = createInfiniteVoidRuntime(redis);
	const service = new AntiNukeService(runtime.client);
	const base = 1_700_000_000_000;
	try {
		AntiNuke.get = async () => settings();
		const first = await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", "600000000000000001", "audit-1", base, base);
		const duplicate = await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", "600000000000000001", "audit-1", base, base + 1);
		assert.equal(first.count, 1);
		assert.equal(duplicate.counted, false);
		assert.equal(duplicate.count, 1);

		for (let i = 2; i <= 49; i++) {
			const eventTime = base + i * 100;
			await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", String(600000000000000000n + BigInt(i)), `audit-${i}`, eventTime, eventTime);
		}
		const newWindowTime = base + INFINITE_VOID_WINDOW_MS + 10_000;
		const rolled = await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", "600000000000000099", "audit-new-window", newWindowTime, newWindowTime);
		assert.equal(rolled.count, 1);
		assert.equal(rolled.thresholdReached, false);
		assert.equal(runtime.bans, 0);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("Infinite Void threshold is atomic across processes and revokes bypasses", async () => {
	const originalGet = AntiNuke.get;
	const originalUpdate = AntiNuke.update;
	const executorId = "567890123456789012";
	const otherOwnerId = "678901234567890123";
	const redis = createInfiniteVoidRedis();
	redis.strings.set(`extraowners:123456789012345678`, JSON.stringify([
		{ userId: executorId, limits: {} },
		{ userId: otherOwnerId, limits: {} },
	]));
	const runtime = createInfiniteVoidRuntime(redis, executorId);
	let current = settings({ trustedUsers: [{ id: executorId }], admin: executorId });
	let updates = 0;
	try {
		AntiNuke.get = async () => current;
		AntiNuke.update = async (_guildId, patch) => {
			updates++;
			current = settings({ ...current, ...patch });
			return new AntiNuke(runtime.guild.id, current);
		};
		const firstProcess = new AntiNukeService(runtime.client);
		const secondProcess = new AntiNukeService(runtime.client);
		const now = 1_700_000_100_000;
		for (let i = 1; i < INFINITE_VOID_THRESHOLD; i++) {
			await firstProcess.recordInfiniteVoidKick(runtime.guild, executorId, String(700000000000000000n + BigInt(i)), `incident-${i}`, now + i, now + i);
		}
		const results = await Promise.all([
			firstProcess.recordInfiniteVoidKick(runtime.guild, executorId, "700000000000000050", "incident-50", now + 50, now + 50),
			secondProcess.recordInfiniteVoidKick(runtime.guild, executorId, "700000000000000050", "incident-50", now + 50, now + 50),
		]);
		assert.equal(results.filter((result) => result.incidentAcquired).length, 1);
		assert.equal(results.filter((result) => result.punished).length, 1);
		assert.equal(runtime.bans, 1);
		assert.equal(updates, 1);
		assert.deepEqual(current.trustedUsers, []);
		assert.equal(current.admin, null);
		assert.deepEqual(JSON.parse(redis.strings.get(`extraowners:${runtime.guild.id}`)), [{ userId: otherOwnerId, limits: {} }]);
	} finally {
		AntiNuke.get = originalGet;
		AntiNuke.update = originalUpdate;
	}
});

test("Infinite Void still punishes when independent bypass revocations fail", async () => {
	const originalGet = AntiNuke.get;
	const originalUpdate = AntiNuke.update;
	const executorId = "567890123456789012";
	const redis = createInfiniteVoidRedis({ failRevoke: true });
	const runtime = createInfiniteVoidRuntime(redis, executorId);
	try {
		AntiNuke.get = async () => settings({ trustedUsers: [{ id: executorId }], admin: executorId });
		AntiNuke.update = async () => { throw new Error("database unavailable"); };
		const service = new AntiNukeService(runtime.client);
		const now = 1_700_000_200_000;
		let result;
		for (let i = 1; i <= INFINITE_VOID_THRESHOLD; i++) {
			result = await service.recordInfiniteVoidKick(
				runtime.guild,
				executorId,
				String(710000000000000000n + BigInt(i)),
				`revocation-failure-${i}`,
				now + i,
				now + i,
			);
		}
		assert.equal(result.incidentAcquired, true);
		assert.equal(result.punished, true);
		assert.equal(runtime.bans, 1);
	} finally {
		AntiNuke.get = originalGet;
		AntiNuke.update = originalUpdate;
	}
});

test("Infinite Void rejects stale and future audit entries", async () => {
	const originalGet = AntiNuke.get;
	const redis = createInfiniteVoidRedis();
	const runtime = createInfiniteVoidRuntime(redis);
	const service = new AntiNukeService(runtime.client);
	const now = 1_700_000_300_000;
	try {
		AntiNuke.get = async () => settings();
		const stale = await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", "720000000000000001", "stale", now - 30_001, now);
		const future = await service.recordInfiniteVoidKick(runtime.guild, "567890123456789012", "720000000000000002", "future", now + 5_001, now);
		assert.equal(stale.counted, false);
		assert.equal(future.counted, false);
		assert.equal(redis.evalCalls, 0);
		assert.equal(runtime.bans, 0);
	} finally {
		AntiNuke.get = originalGet;
	}
});

test("Infinite Void is inert for owners, bots, disabled states, and Redis failures", async () => {
	const originalGet = AntiNuke.get;
	const originalUpdate = AntiNuke.update;
	const executorId = "567890123456789012";
	let updates = 0;
	try {
		const redis = createInfiniteVoidRedis();
		const runtime = createInfiniteVoidRuntime(redis, executorId);
		const service = new AntiNukeService(runtime.client);
		AntiNuke.update = async () => { updates++; throw new Error("must not update"); };

		AntiNuke.get = async () => settings({ enabled: false });
		await service.recordInfiniteVoidKick(runtime.guild, executorId, "800000000000000001", "disabled-global", 1000, 1000);
		AntiNuke.get = async () => settings({ member: settings().member.map((entry) => entry.type === "infiniteVoid" ? { ...entry, enabled: false } : entry) });
		await service.recordInfiniteVoidKick(runtime.guild, executorId, "800000000000000002", "disabled-module", 2000, 2000);
		AntiNuke.get = async () => settings();
		await service.recordInfiniteVoidKick(runtime.guild, runtime.guild.ownerId, "800000000000000003", "owner", 3000, 3000);
		await service.recordInfiniteVoidKick(runtime.guild, runtime.client.user.id, "800000000000000004", "bot", 4000, 4000);
		assert.equal(redis.evalCalls, 0);
		assert.equal(runtime.bans, 0);

		const failedRedis = createInfiniteVoidRedis({ failEval: true });
		const failedRuntime = createInfiniteVoidRuntime(failedRedis, executorId);
		const failedService = new AntiNukeService(failedRuntime.client);
		const result = await failedService.recordInfiniteVoidKick(failedRuntime.guild, executorId, "800000000000000005", "redis-failure", 5000, 5000);
		assert.equal(result.counted, false);
		assert.equal(result.punished, false);
		assert.equal(failedRuntime.bans, 0);
		assert.equal(updates, 0);
	} finally {
		AntiNuke.get = originalGet;
		AntiNuke.update = originalUpdate;
	}
});

test("progressive setup formatting reveals only reached execution lines", () => {
	const steps = ["Checking permissions", "Persisting configuration", "Completed"];
	assert.equal(
		ui.formatSetupProgress(steps, { completed: 0, active: 0 }),
		"<a:arrow:1535258533900193792> **Checking permissions**",
	);
	const progress = ui.formatSetupProgress(steps, { completed: 1, active: 1 });
	assert.equal(progress, [
		"<:tick:1533150498973155490> Checking permissions",
		"<a:arrow:1535258533900193792> **Persisting configuration**",
	].join("\n"));
	assert.doesNotMatch(progress, /Completed/);
	const completed = ui.formatSetupProgress(steps, { completed: steps.length });
	assert.equal(completed.split("\n").length, steps.length);
	assert.ok(completed.split("\n").every((line) => line.startsWith("<:tick:1533150498973155490>")));
	const failed = ui.formatSetupProgress(steps, { completed: 1, failure: { index: 1, message: "database unavailable" } });
	assert.match(failed, /⚠️ \*\*Persisting configuration failed:\*\* database unavailable/);
	assert.doesNotMatch(failed, /Completed/);
});

test("AntiNuke UI source uses real separators instead of drawn separator text", () => {
	const files = [
		"src/commands/security/Antinuke.ts",
		"src/commands/security/Whitelist.ts",
		"src/commands/security/ExtraOwner.ts",
		"src/modules/antiNukeUi.ts",
	];
	const source = files.map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
		.join("\n")
		.replace(/^\s*\/\/.*$/gm, "");
	assert.doesNotMatch(source, /[━─]{4,}|-{5,}/);
	assert.match(source, /SeparatorBuilder/);
});
