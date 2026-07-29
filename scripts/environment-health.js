"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const JSON_ENVIRONMENT_KEYS = [
  "DEVELOPER_IDS",
  "NODES",
  "GROQ_API_KEYS",
  "GEMINI_API_KEYS",
  "OPENROUTER_API_KEYS",
  "HUGGINGFACE_TOKENS",
];

function redactText(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted DATABASE_URI]")
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
}

function loadEnvironment(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return { values: {}, json: {}, errors: [".env is missing. Copy .env.example and configure it."], envPath };

  const values = dotenv.parse(fs.readFileSync(envPath, "utf8"));
  const json = {};
  const errors = [];
  for (const key of JSON_ENVIRONMENT_KEYS) {
    const value = values[key];
    if (!value || !value.trim()) continue;
    try { json[key] = JSON.parse(value); }
    catch (error) { errors.push(`${key} must contain valid JSON (${error.message}).`); }
  }
  return { values, json, errors, envPath };
}

function validateDatabaseUri(value) {
  if (!value) return { error: "DATABASE_URI is missing." };
  if (/user:password@/i.test(value)) return { error: "DATABASE_URI still contains the example credentials." };
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return { error: "DATABASE_URI must use postgresql:// or postgres://." };
    if (!url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/") return { error: "DATABASE_URI must include user, password, host, and database name." };
    return { url };
  } catch (error) { return { error: `DATABASE_URI is invalid (${error.message}).` }; }
}

function checkMigrationIntegrity(root) {
  const migrationDirectory = path.join(root, "packages", "db", "drizzle");
  const journalPath = path.join(migrationDirectory, "meta", "_journal.json");
  const errors = [];
  let journal;
  try { journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); }
  catch (error) { return [`cannot read Drizzle journal (${error.message}).`]; }
  if (!Array.isArray(journal.entries)) return ["Drizzle journal does not contain an entries array."];

  const tags = new Set();
  for (const [index, entry] of journal.entries.entries()) {
    if (!entry || typeof entry.tag !== "string" || !entry.tag) { errors.push(`journal entry ${index} has no migration tag.`); continue; }
    if (entry.idx !== index) errors.push(`journal entry ${entry.tag} has index ${entry.idx}; expected ${index}.`);
    if (tags.has(entry.tag)) errors.push(`journal contains duplicate migration tag ${entry.tag}.`);
    tags.add(entry.tag);
    if (!fs.existsSync(path.join(migrationDirectory, `${entry.tag}.sql`))) errors.push(`journal migration ${entry.tag}.sql is missing.`);
  }
  for (const file of fs.readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name))) {
    if (!tags.has(path.basename(file, ".sql"))) errors.push(`migration ${file} is not listed in meta/_journal.json.`);
  }
  return errors;
}

function formatPostgresError(error) {
  const parts = [];
  if (error && error.code) parts.push(`code ${error.code}`);
  if (error && error.message) parts.push(redactText(error.message));
  if (error && error.detail) parts.push(`detail: ${redactText(error.detail)}`);
  if (error && error.where) parts.push(`where: ${redactText(error.where)}`);
  return parts.length ? parts.join("; ") : "unknown PostgreSQL error";
}

function composeEnvironment(environment) {
  if (Array.isArray(environment)) return Object.fromEntries(environment.map((item) => item.split(/=(.*)/s, 2)));
  return environment && typeof environment === "object" ? environment : {};
}

function checkComposePostgres(root, composeFile, databaseUrl) {
  if (!fs.existsSync(composeFile) || !databaseUrl) return null;
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  if (/(^|\n)POSTGRES_(USER|PASSWORD|DB)=\s*(\n|$)/.test(raw) || !/(^|\n)POSTGRES_USER=/.test(raw)) return null;
  const result = require("node:child_process").spawnSync("docker", ["compose", "-f", composeFile, "--env-file", path.join(root, ".env"), "config", "--format", "json"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return { error: `could not inspect Docker Compose configuration (${redactText(result.stderr || result.stdout || "unknown error")})` };
  try {
    const config = JSON.parse(result.stdout);
    const service = Object.values(config.services || {}).find((candidate) => /postgres/i.test(candidate.image || "") || "POSTGRES_USER" in composeEnvironment(candidate.environment));
    if (!service) return null;
    const environment = composeEnvironment(service.environment);
    const expected = [decodeURIComponent(databaseUrl.username), decodeURIComponent(databaseUrl.password), decodeURIComponent(databaseUrl.pathname.slice(1))];
    const actual = [environment.POSTGRES_USER, environment.POSTGRES_PASSWORD, environment.POSTGRES_DB];
    return expected.every((value, index) => value === actual[index]) ? {} : { error: "POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB do not match DATABASE_URI." };
  } catch (error) { return { error: `could not parse Docker Compose configuration (${redactText(error.message)})` }; }
}

module.exports = { JSON_ENVIRONMENT_KEYS, redactText, loadEnvironment, validateDatabaseUri, checkMigrationIntegrity, formatPostgresError, checkComposePostgres };
