import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const root = "apps/bot/src";
const emojiRegex = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}\u2714\u2716\u2705\u274C\u2757\u2753\u2764\u2B50\u2B55\u2049\u203C]/gu;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

const files = walk(root);
let total = 0;
for (const f of files) {
  const content = readFileSync(f, "utf8");
  const lines = content.split("\n");
  let fileHasMatch = false;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(emojiRegex);
    if (matches) {
      if (!fileHasMatch) {
        console.log("\n=== " + f + " ===");
        fileHasMatch = true;
      }
      total += matches.length;
      console.log(`${i + 1}: [${matches.join(" ")}] ${lines[i].trim().slice(0, 160)}`);
    }
  }
}
console.log("\nTOTAL MATCHES: " + total);
