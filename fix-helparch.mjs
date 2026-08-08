import { readFileSync, writeFileSync } from "fs";
const path = "apps/bot/src/config/helpArchitecture.ts";
let content = readFileSync(path, "utf8");
const before = content.split("\n").length;
content = content.replace(/[ \t]*emoji: ".*?",\r?\n/g, "");
writeFileSync(path, content);
console.log("lines before:", before, "after:", content.split("\n").length);
