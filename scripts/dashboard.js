#!/usr/bin/env node
// Soward/Elfaria Bot — Production CLI Dashboard
// Run: node scripts/dashboard.js
"use strict";

const { execSync, spawn, spawnSync } = require("node:child_process");
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
const LOG_DIR = path.join(ROOT, "logs");
const PM2_NAME = "soward-bot";

fs.mkdirSync(LOG_DIR, { recursive: true });
const DASH_LOG = path.join(LOG_DIR, "dashboard.log");

// ─── Logging ────────────────────────────────────────────────────────────────
function dlog(level, msg) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(DASH_LOG, `[${ts}] [${level}] ${msg}\n`); } catch {}
}
const ok   = (m) => { console.log(`  ${C.green}[✓]${C.reset} ${m}`); dlog("OK", m); };
const warn = (m) => { console.log(`  ${C.yellow}[!]${C.reset} ${m}`); dlog("WARN", m); };
const err  = (m) => { console.log(`  ${C.red}[✗]${C.reset} ${m}`); dlog("ERROR", m); };
const info = (m) => { console.log(`  ${C.cyan}[~]${C.reset} ${m}`); dlog("INFO", m); };

// ─── Helpers ────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 15000, ...opts }).trim();
  } catch (e) {
    return e.stderr ? e.stderr.trim() : "";
  }
}

function runFull(cmd, opts = {}) {
  try {
    const r = execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 30000, ...opts });
    return { ok: true, stdout: r.trim() };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status };
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
function pm2Available() {
  try { execSync("pm2 --version", { stdio: "pipe", encoding: "utf8" }); return true; } catch { return false; }
}

function pm2Info() {
  if (!pm2Available()) return null;
  try {
    const raw = execSync(`pm2 jlist`, { stdio: "pipe", encoding: "utf8" }).trim();
    const list = JSON.parse(raw);
    return list.find(p => p.name === PM2_NAME) || null;
  } catch { return null; }
}

function pm2IsRunning() {
  const p = pm2Info();
  return p && p.pm2_env && p.pm2_env.status === "online";
}

// ─── Service Check Helpers ──────────────────────────────────────────────────
function getRedisUrl() {
  try {
    const contents = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = contents.match(/^\s*REDIS_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n#]*))/m);
    if (m) return (m[1] ?? m[2] ?? m[3] ?? "").trim();
  } catch {}
  return process.env.REDIS_URL || "redis://127.0.0.1:6379/0";
}

function isRedisRunning() {
  try {
    const url = new URL(getRedisUrl());
    const r = spawnSync("redis-cli", ["-h", url.hostname, "-p", url.port || "6379", "PING"], { encoding: "utf8", timeout: 3000 });
    return r.stdout && r.stdout.trim() === "PONG";
  } catch { return false; }
}

function isPostgresRunning() {
  try {
    const contents = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = contents.match(/^\s*DATABASE_URI\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n#]*))/m);
    const uri = m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
    if (!uri) return false;
    const r = spawnSync("node", ["-e", `const{Client}=require('pg');const c=new Client({connectionString:'${uri.replace(/'/g, "\\'")}',connectionTimeoutMillis:4000});c.connect().then(()=>c.query('SELECT 1')).then(()=>{console.log('OK');c.end()}).catch(()=>{console.log('FAIL');c.end()})`], { cwd: ROOT, encoding: "utf8", timeout: 8000 });
    return r.stdout && r.stdout.trim() === "OK";
  } catch { return false; }
}

// ─── Logo & Header ──────────────────────────────────────────────────────────
function printHeader() {
  process.stdout.write("\x1b[2J\x1b[H");
  console.log(`${C.cyan}${C.bold}
  ╔═══════════════════════════════════════╗
  ║     S O W A R D   D A S H B O A R D  ║
  ╚═══════════════════════════════════════╝${C.reset}
`);
  // Quick status bar
  const botUp = pm2IsRunning();
  const redis = isRedisRunning();
  const pInfo = pm2Info();
  const pid = pInfo ? pInfo.pid : "—";
  const uptime = pInfo && pInfo.pm2_env && pInfo.pm2_env.pm_uptime
    ? formatUptime(Date.now() - pInfo.pm2_env.pm_uptime) : "—";
  const mem = pInfo && pInfo.monit ? `${Math.round(pInfo.monit.memory / 1048576)}MB` : "—";
  const cpu = pInfo && pInfo.monit ? `${pInfo.monit.cpu}%` : "—";

  const branch = run("git rev-parse --abbrev-ref HEAD") || "—";
  const commit = run("git log -1 --format=%h") || "—";
  const commitMsg = run('git log -1 --format=%s').slice(0, 50) || "—";

  console.log(`  ${C.bold}Bot${C.reset}     ${botUp ? `${C.green}ONLINE${C.reset}` : `${C.red}OFFLINE${C.reset}`}  PID: ${pid}  Uptime: ${uptime}`);
  console.log(`  ${C.bold}Resources${C.reset} CPU: ${cpu}  RAM: ${mem}`);
  console.log(`  ${C.bold}Redis${C.reset}   ${redis ? `${C.green}ONLINE${C.reset}` : `${C.red}OFFLINE${C.reset}`}    ${C.bold}Branch${C.reset} ${branch} (${commit})`);
  console.log(`  ${C.bold}Commit${C.reset}  ${commitMsg}`);
  console.log(`  ${C.gray}${"─".repeat(50)}${C.reset}\n`);
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

// ─── Action: Status ─────────────────────────────────────────────────────────
async function showStatus() {
  printHeader();
  info("Detailed Status\n");

  // Bot process
  const pInfo = pm2Info();
  if (pInfo && pInfo.pm2_env) {
    const env = pInfo.pm2_env;
    ok(`Bot: ${env.status} (PID: ${pInfo.pid})`);
    info(`  Restarts: ${env.restart_time}  |  Uptime: ${formatUptime(Date.now() - env.pm_uptime)}`);
    info(`  CPU: ${pInfo.monit?.cpu || 0}%  |  RAM: ${Math.round((pInfo.monit?.memory || 0) / 1048576)}MB`);
  } else {
    err("Bot: not running via PM2");
  }

  // Redis
  if (isRedisRunning()) ok("Redis: responding (PONG)");
  else err("Redis: not responding");

  // PostgreSQL
  if (isPostgresRunning()) ok("PostgreSQL: connected");
  else err("PostgreSQL: connection failed");

  // Build
  if (fs.existsSync(BOT_ENTRY)) ok(`Build: ${BOT_ENTRY} exists`);
  else err("Build: dist/index.js missing");

  // Last startup error
  const errLog = path.join(LOG_DIR, "bot-err.log");
  if (fs.existsSync(errLog)) {
    const lines = fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean).slice(-5);
    if (lines.length) {
      warn("Recent errors:");
      lines.forEach(l => console.log(`    ${C.red}${l.slice(0, 120)}${C.reset}`));
    }
  }

  await pressEnter();
}

// ─── Action: Start Bot ──────────────────────────────────────────────────────
async function startBot() {
  printHeader();
  if (!pm2Available()) { err("PM2 is not installed. Run: npm install -g pm2"); await pressEnter(); return; }
  if (pm2IsRunning()) { warn("Bot is already running."); await pressEnter(); return; }
  if (!fs.existsSync(BOT_ENTRY)) { err(`Build not found at ${BOT_ENTRY}. Use 'Build & Restart' first.`); await pressEnter(); return; }
  if (!fs.existsSync(ECOSYSTEM)) { err("ecosystem.config.js missing from project root."); await pressEnter(); return; }

  info("Starting bot via PM2...");
  const r = runFull(`pm2 start ${ECOSYSTEM} --env production`);
  if (r.ok) {
    ok("Bot started successfully.");
    run("pm2 save");
    // Show first few lines of output
    await new Promise(res => setTimeout(res, 3000));
    const p = pm2Info();
    if (p && p.pm2_env && p.pm2_env.status === "online") ok(`Confirmed online (PID: ${p.pid})`);
    else warn("Process started but status unclear. Check logs.");
  } else {
    err(`Start failed (exit ${r.code})`);
    if (r.stderr) console.log(`    ${C.red}${r.stderr.slice(0, 300)}${C.reset}`);
  }
  await pressEnter();
}

// ─── Action: Stop Bot ───────────────────────────────────────────────────────
async function stopBot() {
  printHeader();
  if (!pm2Available()) { err("PM2 is not installed."); await pressEnter(); return; }
  if (!pm2IsRunning()) { warn("Bot is not running."); await pressEnter(); return; }

  info("Stopping bot gracefully...");
  const r = runFull(`pm2 stop ${PM2_NAME}`);
  if (r.ok) { ok("Bot stopped."); run("pm2 save"); }
  else { err(`Stop failed: ${r.stderr || "unknown"}`); }
  await pressEnter();
}

// ─── Action: Restart Bot ────────────────────────────────────────────────────
async function restartBot() {
  printHeader();
  if (!pm2Available()) { err("PM2 is not installed."); await pressEnter(); return; }
  if (!fs.existsSync(BOT_ENTRY)) { err("No build found. Build first."); await pressEnter(); return; }

  info("Restarting bot...");
  const r = runFull(`pm2 restart ${PM2_NAME}`);
  if (r.ok) { ok("Bot restarted."); run("pm2 save"); }
  else {
    // If not in PM2 list yet, start fresh
    info("Process not found in PM2, starting fresh...");
    const s = runFull(`pm2 start ${ECOSYSTEM} --env production`);
    if (s.ok) { ok("Bot started."); run("pm2 save"); }
    else err(`Start failed: ${s.stderr || "unknown"}`);
  }
  await pressEnter();
}

// ─── Action: Git Pull ───────────────────────────────────────────────────────
async function gitPull() {
  printHeader();
  info("Git Pull\n");
  dlog("INFO", "Git pull requested");

  // Show current status
  const branch = run("git rev-parse --abbrev-ref HEAD") || "unknown";
  const currentCommit = run("git log -1 --format='%h %s'") || "unknown";
  info(`Branch: ${branch}`);
  info(`Current: ${currentCommit}\n`);

  // Check for local changes
  const status = run("git status --porcelain");
  if (status) {
    warn("Local changes detected:");
    status.split("\n").slice(0, 10).forEach(l => console.log(`    ${C.yellow}${l}${C.reset}`));
    console.log("");
    const choice = await ask("Stash local changes and pull? (y/N)");
    if (choice.toLowerCase() !== "y") { warn("Pull cancelled."); await pressEnter(); return; }
    run("git stash");
    ok("Changes stashed.");
  }

  // Pull
  info("Pulling latest...");
  const result = runFull("git pull");
  if (result.ok) {
    ok("Pull successful.");
    if (result.stdout) console.log(`\n${C.gray}${result.stdout.slice(0, 500)}${C.reset}`);
    const newCommit = run("git log -1 --format='%h %s'");
    info(`Latest: ${newCommit}`);
    console.log("");
    info("Run 'Build & Restart' when ready to deploy these changes.");
  } else {
    err(`Pull failed (exit ${result.code})`);
    if (result.stderr) console.log(`    ${C.red}${result.stderr.slice(0, 300)}${C.reset}`);
    info("Suggested fix: resolve merge conflicts or run 'git reset --hard origin/main'");
  }
  await pressEnter();
}

// ─── Action: Build & Restart ────────────────────────────────────────────────
async function buildAndRestart() {
  printHeader();
  info("Build & Restart\n");
  dlog("INFO", "Build and restart requested");

  if (!pm2Available()) { err("PM2 is not installed. Run: npm install -g pm2"); await pressEnter(); return; }

  // 1. Check if yarn install is needed (compare lockfile hash)
  info("Checking dependencies...");
  const needsInstall = !fs.existsSync(path.join(ROOT, "node_modules", ".yarn-integrity"));
  if (needsInstall) {
    info("Installing dependencies...");
    const install = runFull("yarn install --frozen-lockfile");
    if (!install.ok) {
      err(`Dependency install failed (exit ${install.code})`);
      if (install.stderr) console.log(`    ${C.red}${install.stderr.slice(0, 300)}${C.reset}`);
      await pressEnter(); return;
    }
    ok("Dependencies installed.");
  } else {
    ok("Dependencies up to date.");
  }

  // 2. Build shared packages first
  info("Building @repo/env...");
  let r = runFull("yarn workspace @repo/env build");
  if (!r.ok) { err(`@repo/env build failed: ${r.stderr?.slice(0, 200)}`); await pressEnter(); return; }

  info("Building @repo/db...");
  r = runFull("yarn workspace @repo/db build");
  if (!r.ok) { err(`@repo/db build failed: ${r.stderr?.slice(0, 200)}`); await pressEnter(); return; }

  // 3. Build bot
  info("Building bot...");
  r = runFull("yarn workspace bot build");
  if (!r.ok) {
    err(`Bot build failed (exit ${r.code})`);
    if (r.stderr) console.log(`    ${C.red}${r.stderr.slice(0, 400)}${C.reset}`);
    await pressEnter(); return;
  }

  // 4. Validate build
  if (!fs.existsSync(BOT_ENTRY)) {
    err("Build produced no output. dist/index.js is missing.");
    await pressEnter(); return;
  }
  ok("Build successful.");

  // 5. Validate env
  info("Validating environment...");
  const envCheck = runFull("node scripts/doctor.js");
  if (!envCheck.ok) {
    warn("Doctor reported issues (bot may still start):");
    if (envCheck.stdout) console.log(`    ${C.yellow}${envCheck.stdout.slice(0, 300)}${C.reset}`);
  } else {
    ok("Environment validated.");
  }

  // 6. Stop existing, start fresh
  info("Stopping existing bot process...");
  run(`pm2 stop ${PM2_NAME} 2>/dev/null || true`);
  run(`pm2 delete ${PM2_NAME} 2>/dev/null || true`);

  info("Starting bot...");
  const start = runFull(`pm2 start ${ECOSYSTEM} --env production`);
  if (!start.ok) {
    err(`PM2 start failed: ${start.stderr?.slice(0, 200)}`);
    await pressEnter(); return;
  }

  // 7. Wait and confirm
  await new Promise(res => setTimeout(res, 4000));
  const p = pm2Info();
  if (p && p.pm2_env && p.pm2_env.status === "online") {
    ok(`Bot is ONLINE (PID: ${p.pid})`);
    run("pm2 save");
    info("Startup logs:");
    const logs = run(`pm2 logs ${PM2_NAME} --nostream --lines 8 2>/dev/null`);
    if (logs) console.log(`${C.gray}${logs}${C.reset}`);
  } else {
    err("Bot did not stay online after start.");
    info("Checking error log...");
    const errLog = path.join(LOG_DIR, "bot-err.log");
    if (fs.existsSync(errLog)) {
      const lines = fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean).slice(-10);
      lines.forEach(l => console.log(`    ${C.red}${l.slice(0, 150)}${C.reset}`));
    }
    info("Suggested: check .env, run 'yarn doctor', or view error logs.");
  }
  await pressEnter();
}

// ─── Action: View Logs ──────────────────────────────────────────────────────
async function viewLogs() {
  printHeader();
  console.log(`  ${C.bold}Log Viewer${C.reset}\n`);
  console.log(`  ${C.cyan}(1)${C.reset} Bot output log (last 50 lines)`);
  console.log(`  ${C.cyan}(2)${C.reset} Bot error log (last 50 lines)`);
  console.log(`  ${C.cyan}(3)${C.reset} Dashboard log (last 30 lines)`);
  console.log(`  ${C.cyan}(4)${C.reset} Follow bot logs LIVE (Ctrl+C to stop)`);
  console.log(`  ${C.cyan}(5)${C.reset} Clear all logs`);
  console.log(`  ${C.cyan}(0)${C.reset} Back\n`);

  const choice = await ask("Select");

  if (choice === "1") {
    const f = path.join(LOG_DIR, "bot-out.log");
    if (fs.existsSync(f)) {
      const lines = fs.readFileSync(f, "utf8").split("\n").slice(-50);
      console.log("");
      lines.forEach(l => console.log(`  ${C.gray}${l}${C.reset}`));
    } else { warn("No bot-out.log found."); }
  } else if (choice === "2") {
    const f = path.join(LOG_DIR, "bot-err.log");
    if (fs.existsSync(f)) {
      const lines = fs.readFileSync(f, "utf8").split("\n").slice(-50);
      console.log("");
      lines.forEach(l => console.log(`  ${C.red}${l}${C.reset}`));
    } else { warn("No bot-err.log found."); }
  } else if (choice === "3") {
    if (fs.existsSync(DASH_LOG)) {
      const lines = fs.readFileSync(DASH_LOG, "utf8").split("\n").slice(-30);
      console.log("");
      lines.forEach(l => console.log(`  ${C.gray}${l}${C.reset}`));
    } else { warn("No dashboard.log found."); }
  } else if (choice === "4") {
    if (!pm2Available()) { err("PM2 not available."); await pressEnter(); return; }
    info("Following live logs (Ctrl+C to stop)...\n");
    try {
      spawnSync("pm2", ["logs", PM2_NAME, "--lines", "20"], { cwd: ROOT, stdio: "inherit" });
    } catch {}
  } else if (choice === "5") {
    const confirm = await ask("Clear all log files? (y/N)");
    if (confirm.toLowerCase() === "y") {
      for (const f of ["bot-out.log", "bot-err.log", "bot.log", "dashboard.log"]) {
        const fp = path.join(LOG_DIR, f);
        try { fs.writeFileSync(fp, ""); } catch {}
      }
      if (pm2Available()) run(`pm2 flush ${PM2_NAME} 2>/dev/null || true`);
      ok("Logs cleared.");
    }
  }
  if (choice !== "4") await pressEnter();
}

// ─── Action: Health Check ───────────────────────────────────────────────────
async function healthCheck() {
  printHeader();
  info("Health Check\n");

  let issues = 0;

  // PM2 installed
  if (pm2Available()) ok("PM2 installed");
  else { err("PM2 not installed"); issues++; }

  // Bot running + single instance
  const pInfo = pm2Info();
  if (pInfo && pInfo.pm2_env && pInfo.pm2_env.status === "online") {
    ok(`Bot running (PID: ${pInfo.pid})`);
  } else { err("Bot not running"); issues++; }

  // Check for duplicates
  try {
    const raw = execSync("pm2 jlist", { stdio: "pipe", encoding: "utf8" }).trim();
    const all = JSON.parse(raw).filter(p => p.name === PM2_NAME);
    if (all.length > 1) { err(`Multiple instances detected (${all.length}). Run: pm2 delete all && pm2 start ecosystem.config.js`); issues++; }
    else ok("Single instance confirmed");
  } catch {}

  // Redis
  if (isRedisRunning()) ok("Redis responding");
  else { err("Redis not responding"); issues++; }

  // PostgreSQL
  if (isPostgresRunning()) ok("PostgreSQL connected");
  else { err("PostgreSQL connection failed"); issues++; }

  // Build
  if (fs.existsSync(BOT_ENTRY)) ok("Build exists");
  else { err("Build missing (dist/index.js)"); issues++; }

  // Logs writable
  try { fs.accessSync(LOG_DIR, fs.constants.W_OK); ok("Log directory writable"); }
  catch { err("Log directory not writable"); issues++; }

  // PM2 startup
  const startup = run("pm2 startup 2>&1 | grep -i 'already'");
  if (startup) ok("PM2 startup configured");
  else warn("PM2 startup may not be configured. Run: pm2 startup");

  console.log("");
  if (issues === 0) ok("All checks passed.");
  else err(`${issues} issue(s) found.`);

  await pressEnter();
}

// ─── Action: System Info ────────────────────────────────────────────────────
async function systemInfo() {
  printHeader();
  info("System Information\n");
  const cpus = os.cpus();
  const totalMem = (os.totalmem() / 1073741824).toFixed(2);
  const freeMem = (os.freemem() / 1073741824).toFixed(2);

  console.log(`  ${C.cyan}OS${C.reset}        ${os.type()} ${os.release()}`);
  console.log(`  ${C.cyan}CPU${C.reset}       ${cpus[0]?.model || "Unknown"} (${cpus.length} cores)`);
  console.log(`  ${C.cyan}Memory${C.reset}    ${(totalMem - freeMem).toFixed(2)} GB / ${totalMem} GB`);
  console.log(`  ${C.cyan}Node.js${C.reset}   ${process.version}`);
  console.log(`  ${C.cyan}Platform${C.reset}  ${process.platform} ${os.arch()}`);
  try {
    const load = os.loadavg();
    if (load[0] > 0) console.log(`  ${C.cyan}Load${C.reset}      ${load.map(l => l.toFixed(2)).join(" / ")}`);
  } catch {}
  console.log(`  ${C.cyan}Uptime${C.reset}    ${formatUptime(os.uptime() * 1000)}`);

  await pressEnter();
}

// ─── Action: DB Migrate ─────────────────────────────────────────────────────
async function dbMigrate() {
  printHeader();
  info("Running database migrations...\n");
  dlog("INFO", "DB migrate requested");
  const r = spawnSync("yarn", ["db:migrate"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status === 0) ok("Migrations complete.");
  else err(`Migration failed (exit ${r.status}).`);
  await pressEnter();
}

// ─── Action: Doctor ─────────────────────────────────────────────────────────
async function runDoctor() {
  printHeader();
  info("Running deployment health checks...\n");
  spawnSync("node", ["scripts/doctor.js"], { cwd: ROOT, stdio: "inherit" });
  await pressEnter();
}

// ─── Action: PM2 Setup ──────────────────────────────────────────────────────
async function pm2Setup() {
  printHeader();
  info("PM2 Production Setup\n");

  if (!pm2Available()) {
    info("Installing PM2 globally...");
    const r = runFull("npm install -g pm2");
    if (!r.ok) { err("Failed to install PM2."); await pressEnter(); return; }
    ok("PM2 installed.");
  } else {
    ok("PM2 already installed.");
  }

  // Configure startup
  info("Configuring PM2 startup...");
  const startup = run("pm2 startup 2>&1");
  if (startup.includes("sudo")) {
    warn("Run this command manually as shown:");
    const cmd = startup.match(/sudo .+/);
    if (cmd) console.log(`\n  ${C.yellow}${cmd[0]}${C.reset}\n`);
  } else {
    ok("PM2 startup configured.");
  }

  // Save current process list
  run("pm2 save");
  ok("PM2 process list saved.");

  info("\nPM2 is ready for production. Use 'Build & Restart' to start the bot.");
  await pressEnter();
}

// ─── Main Menu ──────────────────────────────────────────────────────────────
const MENU = [
  { num: "1",  label: "Status & Health Overview",   fn: showStatus },
  { num: "2",  label: "Start Bot",                  fn: startBot },
  { num: "3",  label: "Stop Bot",                   fn: stopBot },
  { num: "4",  label: "Restart Bot",                fn: restartBot },
  { num: "5",  label: "Git Pull",                   fn: gitPull },
  { num: "6",  label: "Build & Restart",            fn: buildAndRestart },
  { num: "7",  label: "View Logs",                  fn: viewLogs },
  { num: "8",  label: "Health Check",               fn: healthCheck },
  { num: "9",  label: "System Info",                fn: systemInfo },
  { num: "10", label: "DB Migrate",                 fn: dbMigrate },
  { num: "11", label: "Doctor (preflight)",         fn: runDoctor },
  { num: "12", label: "PM2 Setup",                  fn: pm2Setup },
  { num: "0",  label: "Exit",                       fn: null },
];

async function menu() {
  while (true) {
    printHeader();
    console.log(`  ${C.bold}${C.yellow}[SELECT AN OPTION]${C.reset}\n`);

    for (const item of MENU) {
      const color = item.num === "0" ? C.red : C.cyan;
      console.log(`  ${color}(${item.num.padStart(2)})${C.reset} ${item.label}`);
    }
    console.log("");

    const choice = await ask(">");
    if (choice === "0") {
      console.log(`\n  ${C.green}Goodbye.${C.reset}\n`);
      dlog("INFO", "Dashboard exited");
      process.exit(0);
    }
    const item = MENU.find(m => m.num === choice);
    if (item && item.fn) {
      dlog("INFO", `Selected: ${item.label}`);
      await item.fn();
    } else {
      err(`Invalid option: "${choice}"`);
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

// ─── Signal Handlers ────────────────────────────────────────────────────────
process.on("SIGINT", () => { console.log(`\n  ${C.yellow}Interrupted.${C.reset}`); process.exit(0); });
process.on("uncaughtException", (e) => { err(`Uncaught: ${e.message}`); dlog("ERROR", e.stack || e.message); });
process.on("unhandledRejection", (r) => { err(`Unhandled: ${r}`); dlog("ERROR", String(r)); });

// ─── Entry ──────────────────────────────────────────────────────────────────
menu();
