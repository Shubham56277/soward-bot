"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { describeChildFailure, emitChildOutput, formatDatabaseError } = require("./db-migrate");
const { checkMigrationIntegrity } = require("./migration-integrity");

const ROOT = path.resolve(__dirname, "..");

test("repository migrations are complete and ordered by journal timestamp", () => {
  assert.deepEqual(checkMigrationIntegrity(ROOT), []);
});

test("Drizzle discovers every journal entry in the recorded execution order", () => {
  const { readMigrationFiles } = require("drizzle-orm/migrator");
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "db", "drizzle", "meta", "_journal.json"), "utf8"));
  const discovered = readMigrationFiles({ migrationsFolder: path.join(ROOT, "packages", "db", "drizzle") });
  assert.deepEqual(discovered.map(({ folderMillis }) => folderMillis), journal.entries.map(({ when }) => when));
  assert.equal(discovered.length, journal.entries.length);
});

test("integrity check preserves historical append order and rejects non-monotonic discovery timestamps", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-integrity-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "packages", "db", "drizzle");
  fs.mkdirSync(path.join(directory, "meta"), { recursive: true });
  fs.writeFileSync(path.join(directory, "0000_first.sql"), "SELECT 1;");
  fs.writeFileSync(path.join(directory, "0001_second.sql"), "SELECT 2;");
  fs.writeFileSync(path.join(directory, "meta", "_journal.json"), JSON.stringify({ entries: [
    { idx: 0, tag: "0001_second", when: 2 },
    { idx: 1, tag: "0000_first", when: 1 },
  ] }));

  const errors = checkMigrationIntegrity(root);
  assert.ok(errors.some((error) => error.includes("timestamp 1") && error.includes("after 2")));
});

test("child stdout and stderr are preserved separately and redacted", () => {
  const stdout = [];
  const stderr = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    emitChildOutput({
      stdout: "line one\npostgresql://alice:secret@localhost/app\nline three\n",
      stderr: "warning\npassword=secret-value\n",
    });
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }

  assert.equal(stdout.join(""), "line one\n[redacted DATABASE_URI]\nline three\n");
  assert.equal(stderr.join(""), "warning\npassword=[redacted]\n");
});

test("child failure summaries include the underlying process outcome", () => {
  assert.match(describeChildFailure({ status: 17 }, "Drizzle migration"), /exited with code 17/);
  assert.match(describeChildFailure({ status: null, signal: "SIGTERM" }, "Drizzle migration"), /signal SIGTERM/);
  assert.match(describeChildFailure({ error: new Error("spawn ENOENT") }, "Drizzle migration"), /spawn ENOENT/);
});

test("PostgreSQL diagnostics retain the complete cause chain while redacting secrets", () => {
  const message = formatDatabaseError({
    message: "migration wrapper failed",
    cause: {
      message: "migration failed for postgresql://alice:secret@localhost/app",
      code: "23503",
      detail: "password=secret-value",
      schema: "public",
      table: "user_badges",
      constraint: "user_badges_user_id_users_user_id_fk",
      routine: "ri_ReportViolation",
    },
  });
  assert.match(message, /migration wrapper failed/);
  assert.match(message, /caused by: code 23503/);
  assert.match(message, /schema: public/);
  assert.match(message, /table: user_badges/);
  assert.match(message, /constraint: user_badges_user_id_users_user_id_fk/);
  assert.match(message, /routine: ri_ReportViolation/);
  assert.doesNotMatch(message, /alice:secret|secret-value/);
});

test("journal retains historical append order and includes every prerequisite migration", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "db", "drizzle", "meta", "_journal.json"), "utf8"));
  assert.deepEqual(journal.entries.map(({ tag }) => tag), [
    "0000_dizzy_echo",
    "0001_watery_titanium_man",
    "0003_bot_settings",
    "0004_no_prefix_allowed",
    "0005_playlists",
    "0002_add_moderation_and_security",
    "0006_profile_badges",
    "0007_profile_badges_compatibility",
  ]);
});

test("profile badge migrations preserve legacy columns and guard variable prerequisites", () => {
  for (const name of ["0006_profile_badges.sql", "0007_profile_badges_compatibility.sql"]) {
    const sql = fs.readFileSync(path.join(ROOT, "packages", "db", "drizzle", name), "utf8");
    assert.match(sql, /to_regclass\('public\.user_profiles'\)/);
    assert.match(sql, /jsonb_array_elements_text/);
    assert.match(sql, /to_jsonb\(profile\."badges"\)/);
    assert.match(sql, /ON CONFLICT \("user_id", "badge_key"\) DO NOTHING/);
    assert.doesNotMatch(sql, /(?:DELETE\s+FROM|UPDATE)\s+"?user_profiles"?/i);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+"badge_definitions"/i);
  }
});

test("compatibility migration reconciles skipped prerequisites before badge repair", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "packages", "db", "drizzle", "0007_profile_badges_compatibility.sql"),
    "utf8",
  );
  const prerequisiteStatements = [
    'ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "prefixes"',
    'CREATE TABLE IF NOT EXISTS "user_profiles"',
    'CREATE TABLE IF NOT EXISTS "guild_bot_settings"',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "no_prefix_allowed"',
    'CREATE TABLE IF NOT EXISTS "playlists"',
    'CREATE TABLE IF NOT EXISTS "playlist_tracks"',
  ];
  for (const statement of prerequisiteStatements) assert.ok(sql.includes(statement), `missing: ${statement}`);
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS "user_profiles"') < sql.indexOf('INSERT INTO "user_badges"'));
});