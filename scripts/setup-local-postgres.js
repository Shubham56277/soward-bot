#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvironment, validateDatabaseUri } = require("./environment-health");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const COMPOSE_FILE = path.join(ROOT, "docker", "postgres-compose.yml");
const random = (bytes) => crypto.randomBytes(bytes).toString("base64url");

function setValue(contents, key, value) {
  const line = new RegExp(`^${key}=.*$`, "m");
  return line.test(contents) ? contents.replace(line, `${key}=${value}`) : `${contents.replace(/\s*$/, "")}\n${key}=${value}\n`;
}

if (!fs.existsSync(ENV_PATH)) {
  console.error("[db:local] .env is missing. Copy .env.example, configure it, then run this command again.");
  process.exit(1);
}

const environment = loadEnvironment(ROOT);
if (environment.errors.length) {
  for (const error of environment.errors) console.error(`[db:local] ${error}`);
  process.exit(1);
}

const user = environment.values.POSTGRES_USER || `soward_${random(5)}`;
const password = environment.values.POSTGRES_PASSWORD || random(24);
const database = environment.values.POSTGRES_DB || "soward";
const generatedUri = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:5432/${encodeURIComponent(database)}`;
const existingUri = environment.values.DATABASE_URI;
const isExampleUri = /(?:YOUR_URL_ENCODED_|user:password@)/i.test(existingUri || "");
if (existingUri && !isExampleUri && !validateDatabaseUri(existingUri).error && existingUri !== generatedUri) {
  console.error("[db:local] DATABASE_URI does not match the local Docker PostgreSQL credentials. Update it deliberately or remove it before running this command.");
  process.exit(1);
}

let contents = fs.readFileSync(ENV_PATH, "utf8");
for (const [key, value] of Object.entries({ POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database, DATABASE_URI: generatedUri })) contents = setValue(contents, key, value);
fs.writeFileSync(ENV_PATH, contents, { mode: fs.statSync(ENV_PATH).mode });
const docker = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "--env-file", ENV_PATH, "up", "-d", "postgres"], { cwd: ROOT, stdio: "inherit" });
if (docker.status !== 0) { console.error("[db:local] Docker Compose did not start PostgreSQL. .env was updated with generated credentials; resolve Docker then rerun this command."); process.exit(1); }
console.log("[db:local] Local PostgreSQL is running and DATABASE_URI matches its generated credentials.");
