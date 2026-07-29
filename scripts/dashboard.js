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

const ROOT = path.resolve(__dirname, "..");
const BOT_DIR = path.join(ROOT, "apps", "bot");
const BOT_DIST = path.join(BOT_DIR, "dist");
const STAGED_BOT_DIST = path.join(BOT_DIR, ".dashboard-dist-next");
const BACKUP_BOT_DIST = path.join(BOT_DIR, ".dashboard-dist-previous");
const BOT_ENTRY = path.join(BOT_DIST, "index.js");
const BOT_PID_FILE = path.join(ROOT, "logs", "bot.pid");
const IS_WIN = process.platform === "win32";
const YARN_SHELL = IS_WIN;

// Redis binaries are resolved from PATH on every platform. Explicit paths can
// be supplied with REDIS_SERVER_BIN and REDIS_CLI_BIN when Redis is not on PATH.
function executableOnPath(command) {
  const finder = IS_WIN ? "where.exe" : "which";
  try {
    const result = spawnSync(finder, [command], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) return null;
    return result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

let REDIS_PATH = process.env.REDIS_SERVER_BIN || executableOnPath("redis-server");
let REDIS_CLI = process.env.REDIS_CLI_BIN || executableOnPath("redis-cli");

const DEFAULT_LOCAL_REDIS_URL = "redis://127.0.0.1:6379/0";
const DEFAULT_LOCAL_REDIS_PORT = 6379;

function readRedisUrl() {
  // The checked-out project's .env is the source of truth. This prevents an
  // old exported shell variable from overriding the server's local settings.
  try {
    const contents = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const match = contents.match(/^\s*REDIS_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n#]*))/m);
    if (match) return (match[1] ?? match[2] ?? match[3] ?? "").trim() || DEFAULT_LOCAL_REDIS_URL;
  } catch {}

  return process.env.REDIS_URL || DEFAULT_LOCAL_REDIS_URL;
}

function getRedisConfig() {
  const url = readRedisUrl() || DEFAULT_LOCAL_REDIS_URL;
  try {
    const parsed = new URL(url);
    return {
      url,
      host: parsed.hostname || "localhost",
      port: Number(parsed.port || DEFAULT_LOCAL_REDIS_PORT),
      isLocal: ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    };
  } catch {
    return {
      url: DEFAULT_LOCAL_REDIS_URL,
      host: "127.0.0.1",
      port: DEFAULT_LOCAL_REDIS_PORT,
      isLocal: true,
    };
  }
}

let REDIS = getRedisConfig();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function refreshRedisConfig() {
  REDIS_PATH = process.env.REDIS_SERVER_BIN || executableOnPath("redis-server");
  REDIS_CLI = process.env.REDIS_CLI_BIN || executableOnPath("redis-cli");
  REDIS = getRedisConfig();
  return REDIS;
}

function commandAvailable(command) {
  return Boolean(executableOnPath(command));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = trimmed.indexOf(quote, 1);
    if (end !== -1) return trimmed.slice(1, end);
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

function getEnvFileValue(key) {
  const envPath = path.join(ROOT, ".env");
  try {
    const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.*)$`);
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(matcher);
      if (match) return parseEnvValue(match[1]);
    }
  } catch {}
  return "";
}

function setEnvFileValue(key, value) {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) throw new Error(".env file is missing");

  const keyPattern = new RegExp(`^(\\s*${escapeRegex(key)}\\s*=\\s*)(.*)$`, "m");
  let contents = fs.readFileSync(envPath, "utf8");
  if (keyPattern.test(contents)) {
    contents = contents.replace(keyPattern, (_match, prefix) => `${prefix}${value}`);
  } else {
    contents = `${contents.replace(/\s*$/, "")}\n${key}=${value}\n`;
  }

  const mode = fs.statSync(envPath).mode & 0o777;
  const temporaryPath = `${envPath}.dashboard-tmp`;
  fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode });
  fs.renameSync(temporaryPath, envPath);
  process.env[key] = value;
  refreshRedisConfig();
}

function configuredEnvironmentErrors() {
  const required = ["DISCORD_APP_TOKEN", "DISCORD_APP_CLIENT_ID", "DATABASE_URI"];
  return required.filter((key) => {
    const value = getEnvFileValue(key);
    return !value || (key === "DATABASE_URI" && /user:password@/i.test(value));
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  return result.status === 0;
}

function runPrivilegedCommand(command, args) {
  const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (runningAsRoot) return runCommand(command, args);
  if (!commandAvailable("sudo")) {
    err("sudo is required to install packages and manage Redis, but it was not found.");
    return false;
  }
  return runCommand("sudo", [command, ...args]);
}

function isLocalRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function localRedisUrlForSystemService(currentUrl) {
  const parsed = new URL(currentUrl || DEFAULT_LOCAL_REDIS_URL);
  if (parsed.protocol !== "redis:") {
    throw new Error("a local Redis service requires a redis:// URL, not a TLS Redis URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("the local Redis URL has authentication configured; preserve it and configure Redis authentication manually instead");
  }

  parsed.hostname = "127.0.0.1";
  parsed.port = String(DEFAULT_LOCAL_REDIS_PORT);
  if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/0";
  return parsed.toString();
}

function configureLinuxRedisService(systemctl) {
  const redisConfigPath = "/etc/redis/redis.conf";
  info(`Configuring the local Redis service on 127.0.0.1:${DEFAULT_LOCAL_REDIS_PORT}...`);

  // Standardize the system service instead of launching an unmanaged Redis
  // process. This fixes cloned projects whose .env still contains port 6380.
  if (!runPrivilegedCommand("sed", [
    "-i",
    "-E",
    `s/^[[:space:]]*port[[:space:]]+.*/port ${DEFAULT_LOCAL_REDIS_PORT}/`,
    redisConfigPath,
  ])) {
    err(`Could not update ${redisConfigPath}.`);
    return false;
  }

  if (!runPrivilegedCommand(systemctl, ["enable", "redis-server"])) {
    err("Redis was installed, but its system service could not be enabled.");
    return false;
  }

  if (!runPrivilegedCommand(systemctl, ["restart", "redis-server"])) {
    err("Redis configuration was updated, but the service could not be restarted.");
    return false;
  }

  return true;
}

function installAndConfigureLinuxRedis() {
  const configuredUrl = getEnvFileValue("REDIS_URL");
  const redisUrl = configuredUrl || DEFAULT_LOCAL_REDIS_URL;
  let parsedUrl;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    err("REDIS_URL in .env is not a valid Redis URL.");
    return false;
  }

  if (!isLocalRedisUrl(redisUrl)) {
    info(`REDIS_URL points to remote Redis (${parsedUrl.hostname}); leaving it unchanged.`);
    refreshRedisConfig();
    if (isRedisRunning()) {
      ok(`Remote Redis is reachable at ${REDIS.host}:${REDIS.port}.`);
      return true;
    }
    err(`Remote Redis at ${REDIS.host}:${REDIS.port} is unreachable. Setup cannot manage a remote service.`);
    return false;
  }

  let systemRedisUrl;
  try {
    systemRedisUrl = localRedisUrlForSystemService(redisUrl);
  } catch (error) {
    err(`Redis configuration was not changed: ${error.message}`);
    return false;
  }

  const aptGet = executableOnPath("apt-get");
  const systemctl = executableOnPath("systemctl");
  if (!aptGet || !systemctl) {
    err("This setup currently supports Linux systems with apt-get and systemctl (such as Ubuntu or Debian).");
    return false;
  }

  info("Installing Redis from the operating system package manager...");
  if (!runPrivilegedCommand(aptGet, ["install", "-y", "redis-server"])) {
    err("Redis installation failed.");
    return false;
  }

  if (!configureLinuxRedisService(systemctl)) return false;

  // Persist the exact verified local endpoint only after the service has
  // restarted successfully; a failed setup never leaves .env pointing at a
  // service that could not be started.
  setEnvFileValue("REDIS_URL", systemRedisUrl);
  if (!REDIS_CLI && !commandAvailable("redis-cli")) {
    err("Redis installed but redis-cli is unavailable, so the service could not be verified.");
    return false;
  }
  if (isRedisRunning()) {
    ok(`Redis is ready on ${REDIS.host}:${REDIS.port}; .env was updated.`);
    return true;
  }

  err(`Redis did not respond on ${REDIS.host}:${REDIS.port}. Check: sudo systemctl status redis-server`);
  return false;
}

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
  console.log(`  ${C.cyan}[+] REDIS${C.reset}    ${REDIS.host}:${REDIS.port}`);
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
function redisPingArgs() {
  // `-u redis://…` is unsupported by older Redis CLIs on Windows. The
  // host/port form works on Redis 3+ and is sufficient for a PING check.
  return ["-h", REDIS.host, "-p", String(REDIS.port), "PING"];
}

function isRedisRunning() {
  try {
    const result = spawnSync(REDIS_CLI, redisPingArgs(), { encoding: "utf8", timeout: 3000 });
    return result.stdout && result.stdout.trim() === "PONG";
  } catch {
    return false;
  }
}

function ensureRedis() {
  if (!REDIS_CLI) {
    err("Redis CLI was not found. Install Redis or set REDIS_CLI_BIN to its executable path.");
    return false;
  }
  if (isRedisRunning()) return true;
  if (!REDIS.isLocal) {
    err(`Redis at ${REDIS.host}:${REDIS.port} is unavailable. The dashboard will not start a remote Redis service.`);
    return false;
  }
  if (!REDIS_PATH) {
    err("Redis server was not found. Install Redis or set REDIS_SERVER_BIN to its executable path.");
    return false;
  }

  warn(`Redis not running. Starting Redis on port ${REDIS.port}...`);
  try {
    let startError = null;
    const child = spawn(REDIS_PATH, ["--port", String(REDIS.port), "--save", "", "--appendonly", "no"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => { startError = error; });
    child.unref();

    for (let attempt = 0; attempt < 10; attempt++) {
      if (startError) break;
      const result = spawnSync(REDIS_CLI, redisPingArgs(), { encoding: "utf8", timeout: 1000 });
      if (result.stdout && result.stdout.trim() === "PONG") {
        ok(`Redis started on ${REDIS.host}:${REDIS.port}`);
        return true;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    err(startError ? `Failed to start Redis: ${startError.message}` : "Failed to start Redis. The bot was not started.");
    return false;
  } catch (error) {
    err(`Redis start error: ${error.message}`);
    return false;
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────
function clearBotPid() {
  try { fs.unlinkSync(BOT_PID_FILE); } catch {}
}

async function startBotProcess() {
  if (isBotRunning()) return { ok: false, reason: `Bot is already running (PID: ${getBotPid()})` };
  if (!fs.existsSync(BOT_ENTRY)) return { ok: false, reason: "No bot build exists. Use BUILD BOT or APPLY SOURCE CHANGES first." };
  if (!ensureRedis()) return { ok: false, reason: "Redis is unavailable, so the bot was not started." };

  try {
    const logStream = fs.openSync(path.join(ROOT, "logs", "bot.log"), "a");
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: BOT_DIR,
      detached: true,
      stdio: ["ignore", logStream, logStream],
      windowsHide: true,
    });
    child.unref();
    fs.writeFileSync(BOT_PID_FILE, String(child.pid));
    await sleep(3000);

    if (isBotRunning()) return { ok: true, pid: child.pid };
    clearBotPid();
    return { ok: false, reason: "The bot process exited during startup. Check logs/bot.log." };
  } catch (error) {
    clearBotPid();
    return { ok: false, reason: `Failed to start bot: ${error.message}` };
  }
}

async function stopBotProcess() {
  const pid = getBotPid();
  if (!pid) {
    clearBotPid();
    return { ok: true, wasRunning: false };
  }

  try {
    process.kill(pid, "SIGTERM");
    for (let attempt = 0; attempt < 10 && getBotPid(); attempt++) await sleep(300);
    if (getBotPid()) {
      process.kill(pid, "SIGKILL");
      await sleep(300);
    }
    if (getBotPid()) return { ok: false, wasRunning: true, reason: `Could not stop PID ${pid}.` };
    clearBotPid();
    return { ok: true, wasRunning: true, pid };
  } catch (error) {
    return { ok: false, wasRunning: true, reason: `Failed to stop bot: ${error.message}` };
  }
}

async function startBot() {
  printLogo();
  info("Starting the current build without file watching...");
  log("info", "Bot start requested");
  const result = await startBotProcess();
  if (result.ok) {
    ok(`Bot started in background (PID: ${result.pid})`);
    info("Source edits do not restart this process. Use APPLY SOURCE CHANGES to build and restart once.");
    info("Logs are being written to: logs/bot.log");
  } else {
    warn(result.reason);
  }
  await pressEnter();
}

async function stopBot() {
  printLogo();
  const result = await stopBotProcess();
  if (result.ok && result.wasRunning) {
    ok(`Bot stopped (was PID: ${result.pid})`);
    log("info", `Bot stopped, PID ${result.pid}`);
  } else if (result.ok) {
    warn("Bot is not currently running.");
  } else {
    err(result.reason);
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
    ok(`Redis         — running on ${REDIS.host}:${REDIS.port}`);
  } else {
    err(`Redis         — not running`);
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

function runYarn(args) {
  return spawnSync("yarn", args, { cwd: ROOT, stdio: "inherit", shell: YARN_SHELL });
}

function clearStagedBuild() {
  try { fs.rmSync(STAGED_BOT_DIST, { recursive: true, force: true }); } catch {}
}

function buildBotToStaging() {
  clearStagedBuild();
  info("Building shared database package...");
  const dbResult = runYarn(["workspace", "@repo/db", "build"]);
  if (dbResult.status !== 0) {
    err("Database package build failed. The current bot was left unchanged.");
    return false;
  }

  info("Building bot into an isolated staging directory...");
  const botResult = runYarn(["workspace", "bot", "build", "--outDir", ".dashboard-dist-next"]);
  if (botResult.status !== 0 || !fs.existsSync(path.join(STAGED_BOT_DIST, "index.js"))) {
    err("Bot build failed. The current bot was left unchanged.");
    clearStagedBuild();
    return false;
  }
  return true;
}

function promoteStagedBuild() {
  if (!fs.existsSync(path.join(STAGED_BOT_DIST, "index.js"))) return false;
  try {
    fs.rmSync(BACKUP_BOT_DIST, { recursive: true, force: true });
    if (fs.existsSync(BOT_DIST)) fs.renameSync(BOT_DIST, BACKUP_BOT_DIST);
    fs.renameSync(STAGED_BOT_DIST, BOT_DIST);
    return true;
  } catch (error) {
    err(`Could not activate the staged build: ${error.message}`);
    try {
      if (!fs.existsSync(BOT_DIST) && fs.existsSync(BACKUP_BOT_DIST)) fs.renameSync(BACKUP_BOT_DIST, BOT_DIST);
    } catch {}
    return false;
  }
}

function restorePreviousBuild() {
  try {
    fs.rmSync(BOT_DIST, { recursive: true, force: true });
    if (fs.existsSync(BACKUP_BOT_DIST)) fs.renameSync(BACKUP_BOT_DIST, BOT_DIST);
    return fs.existsSync(BOT_ENTRY);
  } catch (error) {
    err(`Could not restore the previous build: ${error.message}`);
    return false;
  }
}

function discardPreviousBuild() {
  try { fs.rmSync(BACKUP_BOT_DIST, { recursive: true, force: true }); } catch {}
}

async function buildBot() {
  printLogo();
  info("Building the bot without starting or restarting it...\n");
  log("info", "Bot build requested");
  const result = runYarn(["bot:build"]);
  if (result.status === 0) ok("Build complete. Use APPLY SOURCE CHANGES to restart the running bot once.");
  else err("Build failed. The running bot was not interrupted.");
  await pressEnter();
}

async function applySourceChanges() {
  printLogo();
  const wasRunning = isBotRunning();
  info("Building source changes first. No bot restart will occur unless both builds succeed.\n");
  log("info", "Manual source apply requested");

  if (!buildBotToStaging()) {
    warn("Changes were not applied; the current build and bot process remain in place.");
    await pressEnter();
    return;
  }

  if (wasRunning) {
    info("Build passed. Stopping the bot once to activate the new build...");
    const stopped = await stopBotProcess();
    if (!stopped.ok) {
      err(stopped.reason);
      clearStagedBuild();
      await pressEnter();
      return;
    }
  }

  if (!promoteStagedBuild()) {
    clearStagedBuild();
    if (wasRunning) {
      warn("Attempting to start the previous build again...");
      const restored = await startBotProcess();
      if (!restored.ok) err(restored.reason);
    }
    await pressEnter();
    return;
  }

  if (!wasRunning) {
    discardPreviousBuild();
    ok("Changes are ready in dist/. The bot remains stopped; choose START BOT when you want to run it.");
    await pressEnter();
    return;
  }

  info("Starting the updated build without file watching...");
  const started = await startBotProcess();
  if (started.ok) {
    discardPreviousBuild();
    ok(`Changes applied and bot restarted once (PID: ${started.pid}).`);
    info("Future source edits remain inactive until you choose APPLY SOURCE CHANGES again.");
  } else {
    err(`The updated bot did not stay running: ${started.reason}`);
    warn("Restoring the previous build and starting it again...");
    if (restorePreviousBuild()) {
      const restored = await startBotProcess();
      if (restored.ok) ok(`Previous build restored (PID: ${restored.pid}).`);
      else err(`Previous build could not be restarted: ${restored.reason}`);
    }
  }

  await pressEnter();
}

async function setupLinuxServer() {
  printLogo();
  log("info", "Linux server setup requested");

  if (process.platform !== "linux") {
    err("SET UP THIS LINUX SERVER only runs on Linux. It made no changes on this machine.");
    await pressEnter();
    return;
  }
  if (isBotRunning()) {
    warn("The bot is already running. Setup refuses to replace dependencies or builds for a live bot.");
    info("Stop the bot first, or use APPLY SOURCE CHANGES for a controlled build and restart.");
    await pressEnter();
    return;
  }
  if (!fs.existsSync(path.join(ROOT, ".env"))) {
    err(".env is missing. Copy .env.example, enter your values, then run setup again.");
    await pressEnter();
    return;
  }

  const missingEnvironment = configuredEnvironmentErrors();
  if (missingEnvironment.length > 0) {
    err(`.env is missing required configuration: ${missingEnvironment.join(", ")}.`);
    info("Enter valid values before setup. Existing .env values and secrets are never overwritten.");
    await pressEnter();
    return;
  }

  const nodeMajor = Number((process.version.match(/^v(\d+)/) || [])[1]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
    err(`Node.js ${process.version} is unsupported. Install Node.js 18 or later, then run yarn dashboard again.`);
    await pressEnter();
    return;
  }
  if (!commandAvailable("yarn")) {
    err("Yarn was not found on PATH. Install Yarn 1.22+, then run yarn dashboard again.");
    await pressEnter();
    return;
  }

  const confirmation = await ask("This uses sudo to install Ubuntu packages, may set local REDIS_URL to port 6379, installs dependencies, runs DB migrations, builds, and starts the bot. Type SETUP to continue");
  if (confirmation !== "SETUP") {
    warn("Linux server setup cancelled. No changes were made.");
    await pressEnter();
    return;
  }

  const aptGet = executableOnPath("apt-get");
  if (!aptGet) {
    err("This setup supports Linux distributions with apt-get, such as Ubuntu or Debian.");
    await pressEnter();
    return;
  }

  info("Refreshing system package information...");
  if (!runPrivilegedCommand(aptGet, ["update"])) {
    err("Unable to refresh system packages. Setup stopped before project changes.");
    await pressEnter();
    return;
  }

  info("Installing required system packages...");
  if (!runPrivilegedCommand(aptGet, ["install", "-y", "git", "curl", "ca-certificates", "build-essential", "ffmpeg"])) {
    err("System package installation failed. Resolve the package-manager error and run setup again.");
    await pressEnter();
    return;
  }

  if (!installAndConfigureLinuxRedis()) {
    err("Redis setup did not complete. The bot was not built or started.");
    await pressEnter();
    return;
  }

  info("Installing locked project dependencies...");
  const installResult = runYarn(["install", "--frozen-lockfile"]);
  if (installResult.status !== 0) {
    err("Dependency installation failed. The bot remains stopped.");
    await pressEnter();
    return;
  }

  info("Building the project in an isolated staging directory...");
  if (!buildBotToStaging()) {
    err("Build failed. The bot remains stopped and the active build was not replaced.");
    await pressEnter();
    return;
  }

  info("Applying database migrations for the configured DATABASE_URI...");
  const migrationResult = runYarn(["workspace", "@repo/db", "push"]);
  if (migrationResult.status !== 0) {
    clearStagedBuild();
    err("Database migration failed. The staged build was discarded and the bot remains stopped.");
    await pressEnter();
    return;
  }

  if (!promoteStagedBuild()) {
    clearStagedBuild();
    err("The staged build could not be activated. The bot remains stopped.");
    await pressEnter();
    return;
  }

  info("Starting the prepared build without file watching...");
  const started = await startBotProcess();
  if (!started.ok) {
    restorePreviousBuild();
    err(`Setup finished but the bot did not stay running: ${started.reason}`);
    info("The previous build was restored when available. Check logs/bot.log before starting again.");
    await pressEnter();
    return;
  }

  discardPreviousBuild();
  ok(`Linux server setup is complete. Bot started in background (PID: ${started.pid}).`);
  info("Source edits never restart the bot automatically. Use APPLY SOURCE CHANGES when you are ready to deploy edits.");
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

  if (isRedisRunning()) { ok(`Redis ${REDIS.host}:${REDIS.port}           PONG`); }
  else { err(`Redis ${REDIS.host}:${REDIS.port}           unreachable`); }

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
  else { warn("Bot not built — run option (5)"); }

  // Redis
  if (isRedisRunning()) { ok(`Redis (${REDIS.host}:${REDIS.port}) — running`); }
  else { warn("Redis not running — it will be started when the bot starts, if this is a local Redis URL"); }

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
  { num: "1",  label: "START CURRENT BUILD",                  fn: startBot            },
  { num: "2",  label: "STOP BOT",                             fn: stopBot             },
  { num: "3",  label: "BOT STATUS & HEALTH",                  fn: botStatus           },
  { num: "4",  label: "VIEW BOT LOGS",                        fn: viewBotLogs         },
  { num: "5",  label: "BUILD BOT (NO RESTART)",               fn: buildBot            },
  { num: "6",  label: "APPLY SOURCE CHANGES (BUILD + RESTART)", fn: applySourceChanges },
  { num: "7",  label: "ANALYSE & UPDATE DEPENDENCIES",        fn: analyseAndUpdate    },
  { num: "8",  label: "SYSTEM INFO / CPU USAGE",              fn: systemInfo          },
  { num: "9",  label: "PREMIUM CODE CREATE",                  fn: premiumCreate       },
  { num: "10", label: "PING / CONNECTIVITY TEST",             fn: pingTest            },
  { num: "11", label: "DATABASE PUSH (Drizzle)",              fn: dbPush              },
  { num: "12", label: "SET UP THIS LINUX SERVER",             fn: setupLinuxServer    },
  { num: "13", label: "VIEW DASHBOARD LOGS",                  fn: viewLogs            },
  { num: "0",  label: "EXIT",                                 fn: null                },
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
