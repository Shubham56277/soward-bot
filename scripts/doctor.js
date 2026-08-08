#!/usr/bin/env node
"use strict";

const net = require("node:net");
const tls = require("node:tls");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvironment, validateDatabaseUri, checkMigrationIntegrity, redactText, formatPostgresError, checkComposePostgres } = require("./environment-health");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
let warnings = 0;
const ok = (message) => console.log(`[ok] ${message}`);
const fail = (message) => { failures += 1; console.error(`[x] ${message}`); };
const warn = (message) => { warnings += 1; console.warn(`[!] ${message}`); };

function tcpCheck(url) {
  return new Promise((resolve) => {
    const secure = url.protocol === "rediss:";
    const socket = secure ? tls.connect({ host: url.hostname, port: Number(url.port || 6379), servername: url.hostname }) : net.createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    const done = (result) => { socket.removeAllListeners(); socket.destroy(); resolve(result); };
    socket.setTimeout(4000, () => done({ error: "connection timed out" }));
    socket.once("error", (error) => done({ error: error.message }));
    socket.once(secure ? "secureConnect" : "connect", () => done({}));
  });
}

async function checkDatabase(uri) {
  try {
    const { Client } = require("pg");
    const client = new Client({ connectionString: uri });
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    ok("PostgreSQL is reachable and accepted DATABASE_URI credentials.");
  } catch (error) { fail(`PostgreSQL connection failed: ${formatPostgresError(error)}`); }
}

function checkDocker(databaseUrl) {
  const version = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    warn("Docker is unavailable; Docker container checks were skipped.");
    return false;
  }
  ok(`Docker daemon is reachable (server ${version.stdout.trim() || "unknown"}).`);
  for (const relativeFile of ["docker/docker-compose.yml", "docker/postgres-compose.yml"]) {
    const file = path.join(ROOT, relativeFile);
    const result = checkComposePostgres(ROOT, file, databaseUrl);
    if (result === null) continue;
    if (result.error) fail(`${relativeFile}: ${result.error}`);
    else ok(`${relativeFile}: PostgreSQL credentials match DATABASE_URI.`);
  }
  return true;
}

function checkComposeContainers() {
  for (const relativeFile of ["docker/docker-compose.yml", "docker/postgres-compose.yml"]) {
    const file = path.join(ROOT, relativeFile);
    const result = spawnSync("docker", ["compose", "-f", file, "ps", "--format", "json"], { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0) { warn(`${relativeFile}: could not read container status.`); continue; }
    const entries = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (!entries.length) { warn(`${relativeFile}: no containers are running.`); continue; }
    for (const line of entries) {
      try {
        const container = JSON.parse(line);
        const name = container.Name || container.Service || "container";
        const state = container.State || container.Status || "unknown";
        if (/running/i.test(state)) ok(`${relativeFile}: ${name} is ${state}.`); else warn(`${relativeFile}: ${name} is ${state}.`);
      } catch { warn(`${relativeFile}: received an unreadable container status.`); }
    }
  }
}

async function main() {
  console.log("Soward deployment doctor\n");
  const environment = loadEnvironment(ROOT);
  if (environment.errors.length) environment.errors.forEach(fail); else ok(".env exists and all JSON-valued variables are valid.");

  const integrity = checkMigrationIntegrity(ROOT);
  if (integrity.length) integrity.forEach((error) => fail(`Migration integrity: ${error}`)); else ok("Drizzle migration journal and SQL files are consistent.");

  const database = validateDatabaseUri(environment.values.DATABASE_URI);
  if (database.error) fail(database.error); else await checkDatabase(environment.values.DATABASE_URI);

  const redisValue = environment.values.REDIS_URL;
  if (!redisValue) fail("REDIS_URL is missing.");
  else {
    try {
      const redis = new URL(redisValue);
      if (redis.protocol !== "redis:" && redis.protocol !== "rediss:") fail("REDIS_URL must use redis:// or rediss://.");
      else {
        const status = await tcpCheck(redis);
        if (status.error) fail(`Redis is unreachable at ${redis.hostname}:${redis.port || 6379} (${redactText(status.error)}).`);
        else ok(`Redis is reachable at ${redis.hostname}:${redis.port || 6379}.`);
      }
    } catch (error) { fail(`REDIS_URL is invalid (${error.message}).`); }
  }

  const dockerAvailable = checkDocker(database.url);
  if (dockerAvailable) checkComposeContainers();
  console.log(`\nDoctor finished with ${failures} failure(s) and ${warnings} warning(s).`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => { fail(redactText(error.stack || error.message || error)); process.exitCode = 1; });
