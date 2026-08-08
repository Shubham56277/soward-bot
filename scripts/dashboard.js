#!/usr/bin/env node
// Soward/Elfaria Bot — Production CLI Dashboard
// Run: node scripts/dashboard.js
"use strict";

const { execSync, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// ─── ANSI Colors ────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m",
};

const ROOT = path.resolve(__dirname, "..");
const BOT_DIR = path.join(ROOT, "apps", "bot");
const BOT_ENTRY = path.join(BOT_DIR, "dist", "index.js");
const ECOSYSTEM = path.join(ROOT, "ecosystem.config.js");
const PM2_NAME = "soward-bot";

// ─── Logging ────────────────────────────────────────────────────────────────
const ok   = (m) => console.log(`  ${C.green}[✓]${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}[!]${C.reset} ${m}`);
const err  = (m) => console.log(`  ${C.red}[✗]${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.cyan}[~]${C.reset} ${m}`);

// ─── Helpers ────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 60000, ...opts }).trim();
  } catch (e) {
    return e.stderr ? e.stderr.trim() : (e.stdout ? e.stdout.trim() : "");
  }
}

function runShow(cmd) {
  try {
    const result = execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 120000 });
    return { ok: true, output: result.trim() };
  } catch (e) {
    return { ok: false, output: (e.stderr || e.stdout || "").trim(), code: e.status };
  }
}

function pressEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${C.gray}Press ENTER to return...${C.reset}`, () => { rl.close(); resolve(); });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${C.cyan}[?]${C.reset} ${question}: `, (ans) => { rl.close(); resolve((ans || "").trim()); });
  });
}

// ─── PM2 Helpers ────────────────────────────────────────────────────────────
function pm2Status() {
  try {
    const raw = execSync("pm2 jlist", { stdio: "pipe", encoding: "utf8", timeout: 5000 }).trim();
    const list = JSON.parse(raw);
    const bot = list.find(p => p.name === PM2_NAME);
    if (!bot) return { running: false, status: "not found", pid: 0, restarts: 0, uptime: "—", cpu: "—", mem: "—" };
    const env = bot.pm2_env || {};
    const upMs = env.pm_uptime ? Date.now() - env.pm_uptime : 0;
    return {
      running: env.status === "online",
      status: env.status || "unknown",
      pid: bot.pid || 0,
      restarts: env.restart_time || 0,
      uptime: formatUptime(upMs),
      cpu: `${bot.monit?.cpu || 0}%`,
      mem: `${Math.round((bot.monit?.memory || 0) / 1048576)}MB`,
    };
  } catch { return { running: false, status: "pm2 error", pid: 0, restarts: 0, uptime: "—", cpu: "—", mem: "—" }; }
}

function formatUptime(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ─── Header ─────────────────────────────────────────────────────────────────
function printHeader() {
  process.stdout.write("\x1b[2J\x1b[H");
  const s = pm2Status();
  const branch = run("git rev-parse --abbrev-ref HEAD") || "—";
  const commit = run("git log -1 --format=%h") || "—";
  const commitMsg = run("git log -1 --format=%s").slice(0, 50) || "—";
  const statusColor = s.running ? C.green : C.red;
  const statusText = s.running ? "ONLINE" : "OFFLINE";

  console.log(`${C.cyan}${C.bold}
  ╔═══════════════════════════════════════╗
  ║     S O W A R D   D A S H B O A R D  ║
  ╚═══════════════════════════════════════╝${C.reset}
`);
  console.log(`  ${C.bold}Bot${C.reset}       ${statusColor}${statusText}${C.reset}  PID: ${s.pid}  Uptime: ${s.uptime}  Restarts: ${s.restarts}`);
  console.log(`  ${C.bold}Resources${C.reset} CPU: ${s.cpu}  RAM: ${s.mem}`);
  console.log(`  ${C.bold}Branch${C.reset}    ${branch} (${commit})`);
  console.log(`  ${C.bold}Commit${C.reset}    ${commitMsg}`);
  console.log(`  ${C.gray}${"─".repeat(55)}${C.reset}\n`);
}

// ─── Action: Deploy (Pull + Build + Restart) ────────────────────────────────
async function deploy() {
  printHeader();
  info("Full Deploy: Pull → Build → Restart\n");

  // 1. Pull
  info("Fetching latest from origin/master...");
  const fetch = runShow("git fetch origin master");
  if (!fetch.ok) { err(`Fetch failed: ${fetch.output.slice(0, 200)}`); await pressEnter(); return; }
  
  const merge = runShow("git reset --hard origin/master");
  if (!merge.ok) { err(`Reset failed: ${merge.output.slice(0, 200)}`); await pressEnter(); return; }
  ok("Code updated to latest origin/master.");
  const newCommit = run("git log -1 --format='%h %s'");
  info(`Now at: ${newCommit}\n`);

  // 2. Install deps if needed
  info("Checking dependencies...");
  const install = runShow("yarn install --frozen-lockfile --non-interactive");
  if (!install.ok) { err(`Install failed: ${install.output.slice(0, 300)}`); await pressEnter(); return; }
  ok("Dependencies OK.\n");

  // 3. Build
  info("Building all packages...");
  const build = runShow("yarn build");
  if (!build.ok) { err(`Build failed: ${build.output.slice(0, 400)}`); await pressEnter(); return; }
  ok("Build successful.\n");

  // 4. Restart
  info("Restarting bot...");
  run("pm2 kill 2>/dev/null || true");
  await new Promise(r => setTimeout(r, 2000));
  const start = runShow(`pm2 start ${ECOSYSTEM}`);
  if (!start.ok) { err(`PM2 start failed: ${start.output.slice(0, 200)}`); await pressEnter(); return; }
  run("pm2 save");

  await new Promise(r => setTimeout(r, 5000));
  const s = pm2Status();
  if (s.running) ok(`Bot is ONLINE (PID: ${s.pid})`);
  else err(`Bot status: ${s.status} — check logs with option 5`);

  await pressEnter();
}

// ─── Action: Git Pull Only ──────────────────────────────────────────────────
async function gitPull() {
  printHeader();
  info("Git Pull\n");
  const before = run("git log -1 --format='%h %s'");
  info(`Current: ${before}\n`);

  info("Fetching and resetting to origin/master...");
  run("git fetch origin master");
  const result = runShow("git reset --hard origin/master");
  if (result.ok) {
    ok("Updated successfully.");
    const after = run("git log -1 --format='%h %s'");
    info(`Now at: ${after}`);
    info("\nRun 'Build & Restart' or 'Deploy' to apply changes.");
  } else {
    err(`Failed: ${result.output.slice(0, 300)}`);
  }
  await pressEnter();
}

// ─── Action: Build & Restart ────────────────────────────────────────────────
async function buildAndRestart() {
  printHeader();
  info("Build & Restart\n");

  // Build
  info("Building all packages...");
  const build = runShow("yarn build");
  if (!build.ok) { err(`Build failed: ${build.output.slice(0, 400)}`); await pressEnter(); return; }
  ok("Build successful.\n");

  // Restart
  info("Restarting bot...");
  run("pm2 kill 2>/dev/null || true");
  await new Promise(r => setTimeout(r, 2000));
  const start = runShow(`pm2 start ${ECOSYSTEM}`);
  if (!start.ok) { err(`PM2 start failed: ${start.output.slice(0, 200)}`); await pressEnter(); return; }
  run("pm2 save");

  await new Promise(r => setTimeout(r, 5000));
  const s = pm2Status();
  if (s.running) ok(`Bot is ONLINE (PID: ${s.pid})`);
  else err(`Bot status: ${s.status} — check logs`);

  await pressEnter();
}

// ─── Action: Restart Bot ────────────────────────────────────────────────────
async function restartBot() {
  printHeader();
  info("Restarting bot...\n");

  run("pm2 kill 2>/dev/null || true");
  await new Promise(r => setTimeout(r, 2000));
  const start = runShow(`pm2 start ${ECOSYSTEM}`);
  if (!start.ok) { err(`Start failed: ${start.output.slice(0, 200)}`); await pressEnter(); return; }
  run("pm2 save");

  await new Promise(r => setTimeout(r, 5000));
  const s = pm2Status();
  if (s.running) ok(`Bot is ONLINE (PID: ${s.pid})`);
  else err(`Bot status: ${s.status}`);

  await pressEnter();
}

// ─── Action: Stop Bot ───────────────────────────────────────────────────────
async function stopBot() {
  printHeader();
  info("Stopping bot...\n");
  run(`pm2 stop ${PM2_NAME} 2>/dev/null || true`);
  ok("Bot stopped.");
  run("pm2 save");
  await pressEnter();
}

// ─── Action: View Logs ──────────────────────────────────────────────────────
async function viewLogs() {
  printHeader();
  console.log(`  ${C.bold}Log Viewer${C.reset}\n`);
  console.log(`  ${C.cyan}(1)${C.reset} Bot output (last 40 lines)`);
  console.log(`  ${C.cyan}(2)${C.reset} Bot errors (last 40 lines)`);
  console.log(`  ${C.cyan}(3)${C.reset} Follow live (Ctrl+C to stop)`);
  console.log(`  ${C.cyan}(0)${C.reset} Back\n`);

  const choice = await ask("Select");

  if (choice === "1") {
    const f = path.join(ROOT, "apps", "bot", "logs", "bot-out.log");
    if (fs.existsSync(f)) {
      const lines = fs.readFileSync(f, "utf8").split("\n").slice(-40);
      console.log("");
      lines.forEach(l => console.log(`  ${C.gray}${l}${C.reset}`));
    } else { warn("No bot-out.log found."); }
  } else if (choice === "2") {
    const f = path.join(ROOT, "apps", "bot", "logs", "bot-err.log");
    if (fs.existsSync(f)) {
      const lines = fs.readFileSync(f, "utf8").split("\n").slice(-40);
      console.log("");
      lines.forEach(l => console.log(`  ${C.red}${l}${C.reset}`));
    } else { warn("No bot-err.log found."); }
  } else if (choice === "3") {
    info("Following live logs (Ctrl+C to stop)...\n");
    try { spawnSync("pm2", ["logs", PM2_NAME, "--lines", "30"], { cwd: ROOT, stdio: "inherit" }); } catch {}
  }

  if (choice !== "3") await pressEnter();
}

// ─── Action: Status ─────────────────────────────────────────────────────────
async function showStatus() {
  printHeader();
  info("Detailed Status\n");

  const s = pm2Status();
  if (s.running) {
    ok(`Bot: ${s.status} (PID: ${s.pid})`);
    info(`  Restarts: ${s.restarts}  |  Uptime: ${s.uptime}`);
    info(`  CPU: ${s.cpu}  |  RAM: ${s.mem}`);
  } else {
    err(`Bot: ${s.status}`);
  }

  // Redis
  try {
    const r = spawnSync("redis-cli", ["PING"], { encoding: "utf8", timeout: 3000 });
    if (r.stdout && r.stdout.trim() === "PONG") ok("Redis: responding");
    else err("Redis: not responding");
  } catch { err("Redis: check failed"); }

  // Build
  if (fs.existsSync(BOT_ENTRY)) ok("Build: exists");
  else err("Build: dist/index.js missing");

  // Recent errors
  const errLog = path.join(ROOT, "apps", "bot", "logs", "bot-err.log");
  if (fs.existsSync(errLog)) {
    const lines = fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean).slice(-3);
    if (lines.length) {
      warn("Recent errors:");
      lines.forEach(l => console.log(`    ${C.red}${l.slice(0, 120)}${C.reset}`));
    }
  }

  await pressEnter();
}

// ─── Action: System Info ────────────────────────────────────────────────────
async function systemInfo() {
  printHeader();
  info("System Information\n");
  const totalMem = (os.totalmem() / 1073741824).toFixed(2);
  const freeMem = (os.freemem() / 1073741824).toFixed(2);
  console.log(`  ${C.cyan}OS${C.reset}        ${os.type()} ${os.release()}`);
  console.log(`  ${C.cyan}Memory${C.reset}    ${(totalMem - freeMem).toFixed(2)} GB / ${totalMem} GB`);
  console.log(`  ${C.cyan}Node.js${C.reset}   ${process.version}`);
  console.log(`  ${C.cyan}Uptime${C.reset}    ${formatUptime(os.uptime() * 1000)}`);
  await pressEnter();
}

// ─── Main Menu ──────────────────────────────────────────────────────────────
const MENU = [
  { num: "1", label: "Deploy (Pull + Build + Restart)", fn: deploy },
  { num: "2", label: "Git Pull Only",                   fn: gitPull },
  { num: "3", label: "Build & Restart",                 fn: buildAndRestart },
  { num: "4", label: "Restart Bot",                     fn: restartBot },
  { num: "5", label: "Stop Bot",                        fn: stopBot },
  { num: "6", label: "View Logs",                       fn: viewLogs },
  { num: "7", label: "Status",                          fn: showStatus },
  { num: "8", label: "System Info",                     fn: systemInfo },
  { num: "0", label: "Exit",                            fn: null },
];

async function menu() {
  while (true) {
    printHeader();
    console.log(`  ${C.bold}${C.yellow}[SELECT AN OPTION]${C.reset}\n`);
    for (const item of MENU) {
      const color = item.num === "0" ? C.red : C.cyan;
      console.log(`  ${color}(${item.num})${C.reset} ${item.label}`);
    }
    console.log("");

    const choice = await ask(">");
    if (choice === "0") { console.log(`\n  ${C.green}Goodbye.${C.reset}\n`); process.exit(0); }
    const item = MENU.find(m => m.num === choice);
    if (item && item.fn) await item.fn();
    else { err(`Invalid: "${choice}"`); await new Promise(r => setTimeout(r, 500)); }
  }
}

process.on("SIGINT", () => { console.log(`\n  ${C.yellow}Bye.${C.reset}`); process.exit(0); });
menu();
