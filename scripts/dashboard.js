#!/usr/bin/env node
// Elfaria Bot — CLI Management Dashboard
// Run: node scripts/dashboard.js

"use strict";

const { execSync, spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// ─── ANSI Colors ────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
};

const ROOT       = path.resolve(__dirname, "..");
const REDIS_PATH = "C:\\Users\\Shubham mankar\\AppData\\Local\\Microsoft\\WinGet\\Packages\\taizod1024.redis-windows-fork_Microsoft.Winget.Source_8wekyb3d8bbwe\\Redis-8.8.0-Windows-x64-msys2\\redis-server.exe";
const REDIS_CLI  = REDIS_PATH.replace("redis-server.exe", "redis-cli.exe");
const BOT_PID_FILE = path.join(ROOT, "logs", "bot.pid");

// ─── Logo ─────────────────────────────────────────────────────────────────
function printLogo() {
  process.stdout.write("\x1b[2J\x1b[H"); // clear screen
  console.log(`${C.cyan}${C.bold}
   _____  _  __           _       
  |  ___|| || |  __ _  __(_) __ _ 
  | |_   | || | / _\` ||  _| |/ _\` |
  |  _|  | || || (_| || | | | (_| |
  |_|   |_||_| \\__,_||_| |_|\\__,_|
${C.reset}`);
  console.log(`  ${C.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`  ${C.bold}[+] VERSION${C.reset}  Elfaria-Dashboard-1.0.0`);
  console.log(`  ${C.cyan}[+] BOT${C.reset}      Elfaria#8783`);
  console.log(`  ${C.cyan}[+] REDIS${C.reset}    localhost:6380`);
  console.log(`  ${C.cyan}[+] LAVALINK${C.reset} Railway (lavalink-host-production-5216.up.railway.app)`);
  console.log(`  ${C.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);
}

// ─── Logger ──────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
const LOG_FILE = path.join(ROOT, "logs", "dashboard.log");

function log(level, msg) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(LOG_FILE, `[${ts}] [${level.toUpperCase()}] ${msg}\n`); } catch {}
}

const ok    = (m) => { console.log(`  ${C.green}${C.bold}[+]${C.reset} ${m}`);   log("ok", m); };
const warn  = (m) => { console.log(`  ${C.yellow}${C.bold}[!]${C.reset} ${m}`);   log("warn", m); };
const err   = (m) => { console.log(`  ${C.red}${C.bold}[x]${C.reset} ${m}`);      log("error", m); };
const info  = (m) => { console.log(`  ${C.cyan}${C.bold}[~]${C.reset} ${m}`);     log("info", m); };

// ─── Helpers ─────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 15000, ...opts }).trim();
  } catch (e) {
    return "";
  }
}

function pressEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${C.gray}Press ENTER to return to menu...${C.reset}`, () => { rl.close(); resolve(); });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${C.cyan}${C.bold}[?]${C.reset} ${question}: `, (ans) => { rl.close(); resolve((ans || "").trim()); });
  });
}

// ─── Bot PID helpers ─────────────────────────────────────────────────────
function getBotPid() {
  try {
    const pid = parseInt(fs.readFileSync(BOT_PID_FILE, "utf8").trim(), 10);
    if (!pid || isNaN(pid)) return null;
    // Check if process is still alive
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch { return null; }
}

function isBotRunning() {
  return getBotPid() !== null;
}

// ─── Redis helpers ────────────────────────────────────────────────────────
function isRedisRunning() {
  try {
    const r = spawnSync(REDIS_CLI, ["-p", "6380", "PING"], { encoding: "utf8", timeout: 3000 });
    return r.stdout && r.stdout.trim() === "PONG";
  } catch { return false; }
}

function ensureRedis() {
  if (isRedisRunning()) return true;
  warn("Redis not running. Starting Redis 8 on port 6380...");
  try {
    const child = spawn(REDIS_PATH, ["--port", "6380", "--save", "", "--appendonly", "no"], {
      detached: true, stdio: "ignore",
    });
    child.unref();
    let attempts = 0;
    while (attempts < 10) {
      const { stdout } = spawnSync(REDIS_CLI, ["-p", "6380", "PING"], { encoding: "utf8", timeout: 1000 });
      if (stdout && stdout.trim() === "PONG") { ok("Redis 8 started on port 6380"); return true; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      attempts++;
    }
    err("Failed to start Redis. Bot will not work correctly.");
    return false;
  } catch (e) {
    err(`Redis start error: ${e.message}`);
    return false;
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────
async function startBot() {
  printLogo();
  if (isBotRunning()) {
    warn(`Bot is already running (PID: ${getBotPid()})`);
    await pressEnter();
    return;
  }

  info("Ensuring Redis is running...");
  ensureRedis();

  info("Starting bot in background...\n");
  log("info", "Bot start requested");

  try {
    const child = spawn("yarn", ["bot:dev"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", fs.openSync(path.join(ROOT, "logs", "bot.log"), "a"), fs.openSync(path.join(ROOT, "logs", "bot.log"), "a")],
      shell: true,
    });
    child.unref();
    fs.writeFileSync(BOT_PID_FILE, String(child.pid));

    // Wait a moment then verify
    await new Promise(r => setTimeout(r, 3000));

    if (isBotRunning()) {
      ok(`Bot started in background (PID: ${child.pid})`);
      ok(`Logs are being written to: logs/bot.log`);
      info(`Use option (4) to check bot health, or view logs/bot.log`);
    } else {
      warn("Bot process may have exited — check logs/bot.log for errors");
    }
  } catch (e) {
    err(`Failed to start bot: ${e.message}`);
    log("error", e.stack || e.message);
  }

  await pressEnter();
}

async function stopBot() {
  printLogo();
  const pid = getBotPid();
  if (!pid) {
    warn("Bot is not currently running.");
    await pressEnter();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    await new Promise(r => setTimeout(r, 1500));
    try { process.kill(pid, "SIGKILL"); } catch {} // force if still alive
    try { fs.unlinkSync(BOT_PID_FILE); } catch {}
    ok(`Bot stopped (was PID: ${pid})`);
    log("info", `Bot stopped, PID ${pid}`);
  } catch (e) {
    err(`Failed to stop bot: ${e.message}`);
    // Clean up stale PID file
    try { fs.unlinkSync(BOT_PID_FILE); } catch {}
  }
  await pressEnter();
}

async function botStatus() {
  printLogo();
  info("Bot & Service Status\n");
  log("info", "Status check requested");

  const botPid = getBotPid();
  if (botPid) {
    ok(`Bot process   — running (PID: ${botPid})`);
  } else {
    err(`Bot process   — not running`);
  }

  if (isRedisRunning()) {
    ok(`Redis 8       — running on port 6380`);
  } else {
    err(`Redis 8       — not running`);
  }

  // Discord health endpoint
  try {
    const health = run(`node -e "const h=require('http');h.get('http://127.0.0.1:9090/health',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const p=JSON.parse(d);console.log(JSON.stringify(p))}catch{console.log(d)}});}).on('error',()=>console.log('ERR'))"`);
    if (health && health !== "ERR") {
      const parsed = JSON.parse(health);
      ok(`Bot health    — ${parsed.status || "ok"}`);
      if (parsed.services) {
        info(`  Database  : ${parsed.services.database || "—"}`);
        info(`  Redis     : ${parsed.services.redis || "—"}`);
        info(`  Lavalink  : ${parsed.services.lavalink || "—"}`);
      }
    } else {
      warn(`Bot health    — not reachable (bot may be starting up)`);
    }
  } catch {
    warn(`Bot health    — endpoint not reachable`);
  }

  await pressEnter();
}

async function viewBotLogs() {
  printLogo();
  const logFile = path.join(ROOT, "logs", "bot.log");
  info(`Recent bot logs (last 40 lines from logs/bot.log):\n`);
  try {
    const lines = fs.readFileSync(logFile, "utf8").split("\n").slice(-40);
    lines.forEach(l => console.log(`  ${C.gray}${l}${C.reset}`));
  } catch {
    warn("No bot.log found yet. Start the bot first.");
  }
  await pressEnter();
}

async function buildBot() {
  printLogo();
  info("Building bot (yarn bot:build)...\n");
  log("info", "Bot build requested");
  const result = spawnSync("yarn", ["bot:build"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (result.status === 0) { ok("Build complete."); }
  else { err("Build failed. Check output above."); }
  await pressEnter();
}

async function systemInfo() {
  printLogo();
  info("System Information\n");
  const cpus     = os.cpus();
  const totalMem = (os.totalmem() / 1073741824).toFixed(2);
  const freeMem  = (os.freemem()  / 1073741824).toFixed(2);
  const usedMem  = (totalMem - freeMem).toFixed(2);

  console.log(`  ${C.cyan}OS        :${C.reset} ${os.type()} ${os.release()}`);
  console.log(`  ${C.cyan}CPU       :${C.reset} ${cpus[0]?.model || "Unknown"} (${cpus.length} cores)`);
  console.log(`  ${C.cyan}Memory    :${C.reset} ${usedMem} GB used / ${totalMem} GB total`);
  console.log(`  ${C.cyan}Node.js   :${C.reset} ${process.version}`);
  console.log(`  ${C.cyan}Platform  :${C.reset} ${process.platform}`);
  try {
    const load = os.loadavg();
    if (load[0] > 0) console.log(`  ${C.cyan}Load Avg  :${C.reset} ${load.map(l => l.toFixed(2)).join(" / ")} (1m/5m/15m)`);
  } catch {}
  await pressEnter();
}

async function premiumCreate() {
  printLogo();
  info("Premium Code Generator\n");
  log("info", "Premium create requested");

  const days    = await ask("Duration in days (e.g. 30)");
  const numDays = Number(days) || 30;

  if (numDays <= 0 || numDays > 365) {
    err("Duration must be between 1 and 365 days.");
    await pressEnter();
    return;
  }

  info(`Generating code via bot database (${numDays} days)...`);

  // Call the actual bot command that inserts into DB
  const result = spawnSync(
    "node",
    [
      "-e",
      `
const path = require('path');
// Load env
require('dotenv').config({ path: path.join('${ROOT.replace(/\\/g, "\\\\")}', '.env') });
// Use the DB package to create a real code
const { db, schema } = require('${ROOT.replace(/\\/g, "\\\\")}\\\\packages\\\\db\\\\dist\\\\index.js');
const { createHash, randomBytes } = require('crypto');
const durationMs = ${numDays} * 24 * 60 * 60 * 1000;
const lifetimeMs = 7 * 24 * 60 * 60 * 1000;
const code = 'SWRD-' + randomBytes(16).toString('hex').toUpperCase();
const codeHash = createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
const expiresAt = new Date(Date.now() + lifetimeMs);
db.insert(schema.premiumCodes).values({ codeHash, durationMs, createdBy: 'dashboard', expiresAt })
  .then(() => { console.log(JSON.stringify({ code, expiresAt: expiresAt.toISOString() })); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
`
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 15000, shell: false }
  );

  if (result.status !== 0 || result.stderr) {
    warn("Could not create code via DB directly. Falling back to bot command.");
    info("Run this in your bot's terminal:");
    console.log(`\n  ${C.yellow}?premiumcode create ${numDays}d${C.reset}\n`);
    info("Or use: /premiumcode create duration:" + numDays + "d");
    await pressEnter();
    return;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const expiresFormatted = new Date(parsed.expiresAt).toLocaleString();
    console.log(`\n  ${C.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    ok(`Code    : ${C.bold}${C.yellow}${parsed.code}${C.reset}`);
    ok(`Duration: ${numDays} days`);
    ok(`Code expires at: ${expiresFormatted}`);
    console.log(`  ${C.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    info("Share this code with the user. They redeem it with:");
    info("  ?premium redeem <code>  or  /premium redeem code:<code>");
    log("info", `Generated DB code ${parsed.code} for ${numDays} days`);
  } catch {
    // stdout may have been printed already
    warn("Code may have been created — check bot logs.");
  }

  await pressEnter();
}

async function pingTest() {
  printLogo();
  info("Connectivity Checks\n");
  log("info", "Ping test requested");

  const https = require("node:https");
  async function testHost(label, host) {
    return new Promise(resolve => {
      const t = Date.now();
      const req = https.get(`https://${host}`, { timeout: 5000 }, res => {
        res.resume();
        ok(`${label.padEnd(28)} ${Date.now() - t}ms`);
        resolve(true);
      });
      req.on("error", () => { err(`${label.padEnd(28)} unreachable`); resolve(false); });
      req.on("timeout", () => { req.destroy(); err(`${label.padEnd(28)} timeout`); resolve(false); });
    });
  }

  await testHost("Discord API", "discord.com");
  await testHost("Railway Lavalink", "lavalink-host-production-5216.up.railway.app");
  await testHost("Google (connectivity)", "google.com");

  if (isRedisRunning()) { ok(`Redis localhost:6380           PONG`); }
  else { err(`Redis localhost:6380           unreachable`); }

  await pressEnter();
}

async function dbPush() {
  printLogo();
  info("Running Drizzle DB push...\n");
  log("info", "DB push requested");
  const result = spawnSync("yarn", ["workspace", "@repo/db", "push"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (result.status === 0) { ok("Schema pushed."); }
  else { err("DB push failed. Check output above."); }
  await pressEnter();
}

async function analyseAndUpdate() {
  printLogo();
  info("Analysing workspace dependencies...\n");
  log("info", "Dependency analysis started");

  // Node version
  const [, major] = process.version.match(/^v(\d+)/) || [];
  if (Number(major) >= 18) { ok(`Node.js ${process.version} — compatible`); }
  else { err(`Node.js ${process.version} — requires >= v18`); }

  // .env
  if (fs.existsSync(path.join(ROOT, ".env"))) { ok(".env file present"); }
  else { err(".env file missing"); }

  // dist
  if (fs.existsSync(path.join(ROOT, "apps", "bot", "dist", "index.js"))) { ok("Bot build (dist/) — present"); }
  else { warn("Bot not built — run option (2)"); }

  // Redis
  if (isRedisRunning()) { ok("Redis 8 (port 6380) — running"); }
  else { warn("Redis not running — will auto-start when bot starts"); }

  // Bot running?
  const pid = getBotPid();
  if (pid) { ok(`Bot — running (PID: ${pid})`); }
  else { warn("Bot — not running"); }

  // Outdated packages
  info("\nChecking outdated packages...");
  const outdated = run("yarn outdated 2>&1 || true");
  const outdatedLines = outdated.split("\n").filter(l => l.match(/^\S/) && !l.startsWith("yarn") && !l.startsWith("Done") && !l.startsWith("info") && !l.startsWith("warning") && l.trim().length > 0);

  if (outdatedLines.length === 0) {
    ok("All packages up to date.");
  } else {
    warn(`${outdatedLines.length} package(s) may be outdated:`);
    outdatedLines.slice(0, 10).forEach(l => console.log(`  ${C.yellow}  ${l}${C.reset}`));
    const choice = await ask("\nAuto-update all? (y/N)");
    if (choice.toLowerCase() === "y") {
      info("Running yarn upgrade...");
      const result = spawnSync("yarn", ["upgrade"], { cwd: ROOT, stdio: "inherit", shell: true });
      if (result.status === 0) { ok("Packages updated."); }
      else { err("Update failed."); }
    }
  }

  await pressEnter();
}

async function viewLogs() {
  printLogo();
  info("Recent dashboard logs (last 30 lines):\n");
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-30);
    lines.forEach(l => console.log(`  ${C.gray}${l}${C.reset}`));
  } catch { warn("No log file yet."); }
  await pressEnter();
}

// ─── Main Menu ─────────────────────────────────────────────────────────────
const MENU = [
  { num: "1",  label: "START BOT (background)",         fn: startBot         },
  { num: "2",  label: "STOP BOT",                        fn: stopBot          },
  { num: "3",  label: "BOT STATUS & HEALTH",             fn: botStatus        },
  { num: "4",  label: "VIEW BOT LOGS",                   fn: viewBotLogs      },
  { num: "5",  label: "BUILD BOT",                       fn: buildBot         },
  { num: "6",  label: "ANALYSE & UPDATE DEPENDENCIES",  fn: analyseAndUpdate },
  { num: "7",  label: "SYSTEM INFO / CPU USAGE",         fn: systemInfo       },
  { num: "8",  label: "PREMIUM CODE CREATE",             fn: premiumCreate    },
  { num: "9",  label: "PING / CONNECTIVITY TEST",        fn: pingTest         },
  { num: "10", label: "DATABASE PUSH (Drizzle)",         fn: dbPush           },
  { num: "11", label: "VIEW DASHBOARD LOGS",             fn: viewLogs         },
  { num: "0",  label: "EXIT",                            fn: null             },
];

async function menu() {
  while (true) {
    printLogo();

    // Quick status line
    const botRunning   = isBotRunning();
    const redisRunning = isRedisRunning();
    console.log(`  Status: Bot ${botRunning ? `${C.green}ONLINE${C.reset}` : `${C.red}OFFLINE${C.reset}`}  |  Redis ${redisRunning ? `${C.green}ONLINE${C.reset}` : `${C.red}OFFLINE${C.reset}`}\n`);

    console.log(`  ${C.yellow}${C.bold}[INSERT AN OPTION | PRESS 0 TO EXIT]${C.reset}\n`);

    const left  = MENU.filter((_, i) => i % 2 === 0);
    const right = MENU.filter((_, i) => i % 2 === 1);
    const rows  = Math.max(left.length, right.length);

    for (let i = 0; i < rows; i++) {
      const l = left[i]  ? `${C.cyan}(${left[i].num.padEnd(2)})${C.reset} ${C.white}${left[i].label}${C.reset}` : "";
      const r = right[i] ? `${C.cyan}(${right[i].num.padEnd(2)})${C.reset} ${C.white}${right[i].label}${C.reset}` : "";
      const lClean = left[i]  ? `(${left[i].num.padEnd(2)}) ${left[i].label}` : "";
      const lPad = l + " ".repeat(Math.max(0, 42 - lClean.length));
      console.log(`  ${lPad}  ${r}`);
    }

    console.log(`\n  ${C.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);

    const choice = await ask(`${C.green}[ELFARIA]${C.reset} ——>`);
    if (choice === "0") {
      printLogo();
      ok("Goodbye.");
      log("info", "Dashboard exited");
      process.exit(0);
    }

    const item = MENU.find(m => m.num === choice);
    if (item && item.fn) {
      log("info", `Selected: ${choice} — ${item.label}`);
      await item.fn();
    } else {
      err(`Invalid option: "${choice}"`);
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

// ─── Global error handlers ─────────────────────────────────────────────────
process.on("uncaughtException", (e) => {
  err(`Uncaught exception: ${e.message}`);
  log("error", e.stack || e.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  err(`Unhandled rejection: ${reason}`);
  log("error", String(reason));
});

process.on("SIGINT", () => {
  console.log(`\n  ${C.yellow}Interrupted. Goodbye.${C.reset}`);
  log("info", "Dashboard interrupted by user");
  process.exit(0);
});

// ─── Entry ────────────────────────────────────────────────────────────────
menu();
