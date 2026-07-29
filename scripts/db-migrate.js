#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvironment, validateDatabaseUri, checkMigrationIntegrity, redactText, formatPostgresError } = require("./environment-health");

const ROOT = path.resolve(__dirname, "..");
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const printError = (message) => console.error(`[db:migrate] ${message}`);

function runYarn(args, options = {}) {
  return spawnSync(yarn, args, { cwd: ROOT, encoding: "utf8", ...options });
}

async function verifyDatabase(uri) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: uri, connectionTimeoutMillis: 8000 });
  try { await client.connect(); await client.query("SELECT 1"); }
  finally { await client.end().catch(() => undefined); }
}

async function main() {
  const environment = loadEnvironment(ROOT);
  const uri = validateDatabaseUri(environment.values.DATABASE_URI);
  const integrity = checkMigrationIntegrity(ROOT);
  for (const error of environment.errors) printError(error);
  if (uri.error) printError(uri.error);
  for (const error of integrity) printError(`Migration integrity: ${error}`);
  if (environment.errors.length || uri.error || integrity.length) process.exitCode = 1;
  if (process.exitCode) return;

  try { await verifyDatabase(environment.values.DATABASE_URI); console.log("[db:migrate] PostgreSQL connectivity check passed."); }
  catch (error) { printError(`PostgreSQL connectivity check failed: ${formatPostgresError(error)}`); process.exitCode = 1; return; }

  const environmentBuild = runYarn(["workspace", "@repo/env", "build"], { stdio: "inherit" });
  if (environmentBuild.status !== 0) { printError("Could not build @repo/env; migrations were not started."); process.exitCode = 1; return; }

  const migration = runYarn(["workspace", "@repo/db", "drizzle:migrate"]);
  if (migration.status === 0) { process.stdout.write(migration.stdout || ""); console.log("[db:migrate] Migrations completed successfully."); return; }
  const output = redactText(`${migration.stdout || ""}\n${migration.stderr || ""}`).trim();
  const databaseCode = output.match(/(?:SQLSTATE|code)\s*[:=]?\s*([0-9A-Z]{5})\b/i)?.[1];
  const failedSql = output.match(/(?:failed query|failed SQL|query)\s*:\s*([\s\S]+)/i)?.[1]?.trim();
  printError(`Drizzle migration failed${databaseCode ? ` (database code ${databaseCode})` : ""}.`);
  if (failedSql) printError(`Failed SQL reported by Drizzle: ${redactText(failedSql)}`);
  if (output) console.error(output);
  printError("No bot process was started or restarted.");
  process.exitCode = 1;
}

main().catch((error) => { printError(redactText(error.stack || error.message || error)); process.exitCode = 1; });
