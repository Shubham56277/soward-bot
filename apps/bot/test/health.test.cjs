const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");

const health = require("../dist/modules/health/index.js");
const { LatencyMonitor } = require("../dist/modules/health/latencyMonitor.js");

const baseState = {
	discordConnected: false,
	discordReady: false,
	gatewayPing: null,
	guildCount: 0,
	shardCount: 1,
	databaseHealthy: true,
	redisHealthy: true,
	lavalinkHealthy: null,
};

async function reservePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
	const address = server.address();
	const port = address.port;
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return port;
}

function request(port, path, method = "GET") {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, path, method, agent: false }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => body += chunk);
			res.on("end", () => resolve({ status: res.statusCode, body }));
		});
		req.once("error", reject);
		req.end();
	});
}

test.afterEach(async () => {
	await health.stopHealthServer();
});
test("health endpoints preserve status behavior and lifecycle cleanup", async () => {
	const port = await reservePort();
	const state = { ...baseState };
	await health.startHealthServer(port, () => state);
	assert.ok(health.getLatencyMonitor());

	const liveness = await request(port, "/health");
	assert.equal(liveness.status, 200);
	assert.equal(JSON.parse(liveness.body).status, "starting");
	assert.equal((await request(port, "/ready")).status, 503);
	assert.equal((await request(port, "/health", "POST")).status, 405);
	assert.equal((await request(port, "/missing")).status, 404);

	state.discordConnected = true;
	state.discordReady = true;
	health.markBotReady();
	assert.deepEqual(JSON.parse((await request(port, "/ready")).body), { ready: true });

	await Promise.all([health.stopHealthServer(), health.stopHealthServer()]);
	assert.equal(health.getLatencyMonitor(), null);
	await health.startHealthServer(port, () => state);
	assert.equal((await request(port, "/health")).status, 200);
});

test("health bind failures reject and release monitor state", async () => {
	const blocker = net.createServer();
	await new Promise((resolve, reject) => blocker.listen(0, "127.0.0.1", resolve).once("error", reject));
	const port = blocker.address().port;
	try {
		await assert.rejects(health.startHealthServer(port, () => baseState), (error) => error.code === "EADDRINUSE");
		assert.equal(health.getLatencyMonitor(), null);
	} finally {
		await new Promise((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
	}
});

test("latency samples are bounded, expire, and reject invalid values", () => {
	let now = 1_000;
	const monitor = new LatencyMonitor({ gatewaySampleMaxAgeMs: 100, now: () => now });
	for (let value = 1; value <= 350; value++) monitor.recordGatewayPing(value);
	monitor.recordGatewayPing(Number.NaN);
	monitor.recordGatewayPing(-1);
	const stats = monitor.getGatewayStats();
	assert.equal(stats.samples, 300);
	assert.equal(stats.current, 350);
	assert.equal(stats.min, 51);

	now += 101;
	assert.equal(monitor.getGatewayStats().samples, 0);
	monitor.recordReconnect();
	monitor.recordResume();
	monitor.destroy();
	monitor.recordGatewayPing(10);
	monitor.recordReconnect();
	assert.equal(monitor.getGatewayStats().samples, 0);
	assert.equal(monitor.reconnectCount, 0);
	assert.equal(monitor.resumeCount, 0);
});

test("event-loop stats never expose non-finite sentinel values", async () => {
	const monitor = new LatencyMonitor();
	await new Promise((resolve) => setTimeout(resolve, 30));
	for (const value of Object.values(monitor.getEventLoopStats())) {
		assert.ok(value === null || Number.isFinite(value));
	}
	monitor.destroy();
});