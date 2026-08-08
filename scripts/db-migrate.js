#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadEnvironment, validateDatabaseUri, redactText, formatPostgresError } = require("./environment-health");
const { checkMigrationIntegrity } = require("./migration-integrity");

const ROOT = path.resolve(__dirname, "..");
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const printError = (message) => console.error(`[db:migrate] ${message}`);

/** Capture both streams without spawnSync's maxBuffer truncation, then sanitize before printing. */
function runYarn(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(yarn, args, { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
    const stdout = [];
    const stderr = [];
    let error;
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (cause) => { error = cause; });
    child.once("close", (status, signal) => resolve({
      status,
      signal,
      error,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function writeRedacted(stream, value) {
  if (value) stream.write(redactText(value));
}

function emitChildOutput(result) {
  writeRedacted(process.stdout, result.stdout);
  writeRedacted(process.stderr, result.stderr);
}

function formatDatabaseError(error) {
  const fields = ["severity", "hint", "position", "internalPosition", "internalQuery", "schema", "table", "column", "dataType", "constraint", "file", "line", "routine"];
  const diagnostics = [];
  const seen = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current)) {
    seen.add(current);
    const summary = formatPostgresError(current);
    const details = fields
      .filter((field) => current[field] !== undefined)
      .map((field) => `${field}: ${String(current[field])}`);
    if (summary !== "unknown PostgreSQL error" || details.length) diagnostics.push([summary, ...details].join("; "));
    current = current.cause;
  }
  return redactText(diagnostics.length ? diagnostics.join("; caused by: ") : "unknown PostgreSQL error");
}

function describeChildFailure(result, operation) {
  if (result.error) return `${operation} could not start: ${redactText(result.error.stack || result.error.message || result.error)}`;
  if (result.signal) return `${operation} was terminated by signal ${result.signal}. Complete redacted stdout/stderr is printed above.`;
  return `${operation} exited with code ${result.status ?? "unknown"}. Complete redacted stdout/stderr is printed above.`;
}

function reportChildFailure(result, operation) {
  printError(describeChildFailure(result, operation));
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
  catch (error) { printError(`PostgreSQL connectivity check failed: ${formatDatabaseError(error)}`); process.exitCode = 1; return; }

  const environmentBuild = await runYarn(["workspace", "@repo/env", "build"]);
  emitChildOutput(environmentBuild);
  if (environmentBuild.status !== 0 || environmentBuild.error || environmentBuild.signal) {
    reportChildFailure(environmentBuild, "@repo/env build");
    printError("Could not build @repo/env; migrations were not started.");
    process.exitCode = 1;
    return;
  }

  const migration = await runYarn(["workspace", "@repo/db", "drizzle:migrate"]);
  emitChildOutput(migration);
  if (migration.status === 0 && !migration.error && !migration.signal) { console.log("[db:migrate] Migrations completed successfully."); return; }
  reportChildFailure(migration, "Drizzle migration");
  const output = `${migration.stdout || ""}\n${migration.stderr || ""}`;
  const databaseCode = output.match(/(?:SQLSTATE|code)\s*[:=]?\s*([0-9A-Z]{5})\b/i)?.[1];
  printError(`Drizzle migration failed${databaseCode ? ` (database code ${databaseCode})` : ""}.`);
  printError("No bot process was started or restarted.");
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { printError(redactText(error.stack || error.message || error)); process.exitCode = 1; });
}

module.exports = { describeChildFailure, emitChildOutput, formatDatabaseError, main, runYarn };
