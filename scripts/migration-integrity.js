#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function checkMigrationIntegrity(root) {
  const migrationDirectory = path.join(root, "packages", "db", "drizzle");
  const journalPath = path.join(migrationDirectory, "meta", "_journal.json");
  const errors = [];
  let journal;
  let files;

  try { journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); }
  catch (error) { return [`cannot read Drizzle journal (${error.message}).`]; }
  try {
    files = fs.readdirSync(migrationDirectory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) { return [`cannot read migration directory (${error.message}).`]; }
  if (!Array.isArray(journal.entries)) return ["Drizzle journal does not contain an entries array."];

  const tags = new Set();
  const timestamps = new Set();
  for (const [index, entry] of journal.entries.entries()) {
    if (!entry || typeof entry.tag !== "string" || !entry.tag) {
      errors.push(`journal entry ${index} has no migration tag.`);
      continue;
    }
    if (entry.idx !== index) errors.push(`journal entry ${entry.tag} has index ${entry.idx}; expected ${index}.`);
    if (tags.has(entry.tag)) errors.push(`journal contains duplicate migration tag ${entry.tag}.`);
    tags.add(entry.tag);
    if (!Number.isSafeInteger(entry.when) || entry.when <= 0) errors.push(`journal entry ${entry.tag} has an invalid timestamp.`);
    else if (timestamps.has(entry.when)) errors.push(`journal entry ${entry.tag} reuses timestamp ${entry.when}.`);
    timestamps.add(entry.when);
    if (!fs.existsSync(path.join(migrationDirectory, `${entry.tag}.sql`))) errors.push(`journal migration ${entry.tag}.sql is missing.`);
  }

  for (const file of files) {
    const tag = path.basename(file, ".sql");
    if (!tags.has(tag)) errors.push(`migration ${file} is not listed in meta/_journal.json.`);
  }
  for (let index = 1; index < journal.entries.length; index += 1) {
    const previous = journal.entries[index - 1];
    const current = journal.entries[index];
    if (Number.isSafeInteger(previous?.when) && Number.isSafeInteger(current?.when) && current.when <= previous.when) {
      errors.push(`journal entry ${current.tag || index} has timestamp ${current.when}; expected a value after ${previous.when}.`);
    }
  }
  if (journal.entries.length !== files.length) errors.push(`journal lists ${journal.entries.length} migrations but found ${files.length} SQL files.`);
  return [...new Set(errors)];
}
if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const errors = checkMigrationIntegrity(root);
  if (errors.length) {
    for (const error of errors) console.error(`[db:migrations] ${error}`);
    process.exitCode = 1;
  } else {
    console.log("[db:migrations] Drizzle journal and SQL files are complete and correctly ordered.");
  }
}

module.exports = { checkMigrationIntegrity };