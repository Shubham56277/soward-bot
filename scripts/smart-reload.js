#!/usr/bin/env node
/**
 * Smart Reload Module — Soward/Elfaria Bot
 * 
 * Architecture: PM2 → index.ts (cluster manager) → bot.ts workers (via discord-hybrid-sharding)
 * 
 * Hot-reload strategy:
 * - For command/event/component changes: trigger ReClusterManager gracefulSwitch
 *   (spawns new workers with updated code, then kills old ones — zero downtime)
 * - For core changes: save music state via Redis flag → PM2 restart → restore on startup
 * 
 * The cluster manager already has ReClusterManager with gracefulSwitch mode.
 * We trigger it by writing a Redis key that the manager polls, OR by using PM2 reload.
 */
"use strict";

const { execSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const BOT_DIR = path.join(ROOT, "apps", "bot");
const BOT_ENTRY = path.join(BOT_DIR, "dist", "index.js");
const ECOSYSTEM = path.join(ROOT, "ecosystem.config.js");
const LOCK_FILE = path.join(ROOT, ".deploy.lock");
const LOG_DIR = path.join(ROOT, "logs");
const PM2_NAME = "soward-bot";

// Redis keys
const REDIS_MUSIC_KEY = "deploy:music_sessions";
const REDIS_DEPLOY_CMD = "deploy:command"; // "save_music" | "recluster"
const REDIS_DEPLOY_ACK = "deploy:ack";

// ─── Core files that require full PM2 restart ───────────────────────────────
const RESTART_PATTERNS = [
  /^apps\/bot\/src\/index\.ts$/,
  /^apps\/bot\/src\/bot\.ts$/,
  /^apps\/bot\/src\/cluster\.ts$/,
  /^apps\/bot\/src\/base\/Client\.ts$/,
  /^apps\/bot\/src\/base\/lavalink\//,
  /^apps\/bot\/src\/queues\/index\.ts$/,
  /^packages\//,
  /^\.env$/,
  /^package\.json$/,
  /^yarn\.lock$/,
  /ecosystem\.config/,
];

// ─── Files safe for graceful recluster (new workers pick up new dist) ────────
const RECLUSTER_SAFE = [
  /^apps\/bot\/src\/commands\//,
  /^apps\/bot\/src\/components\//,
  /^apps\/bot\/src\/events\//,
  /^apps\/bot\/src\/config\//,
  /^apps\/bot\/src\/lib\//,
  /^apps\/bot\/src\/modules\//,
  /^apps\/bot\/src\/utils\//,
  /^apps\/bot\/src\/service\//,
  /^apps\/bot\/src\/policies\//,
];

// ─── ANSI ───────────────────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m" };

fs.mkdirSync(LOG_DIR, { recursive: true });
const DEPLOY_LOG = path.join(LOG_DIR, "smart-reload.log");
function dlog(msg) { try { fs.appendFileSync(DEPLOY_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {} }
const ok = m => { console.log(`  ${C.green}[OK]${C.reset} ${m}`); dlog(`OK: ${m}`); };
const info = m => { console.log(`  ${C.cyan}[..]${C.reset} ${m}`); dlog(`INFO: ${m}`); };
const warn = m => { console.log(`  ${C.yellow}[!!]${C.reset} ${m}`); dlog(`WARN: ${m}`); };
const fail = m => { console.log(`  ${C.red}[XX]${C.reset} ${m}`); dlog(`FAIL: ${m}`); };

// ─── Helpers ────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    const stdout = execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 180000, ...opts }).trim();
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim(), code: e.status };
  }
}

function sleep(ms) {
  if (process.platform !== "win32") spawnSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
  else { const end = Date.now() + ms; while (Date.now() < end) {} }
}

function pm2Ok() { try { execSync("pm2 --version", { stdio: "pipe" }); return true; } catch { return false; } }
function pm2Running() {
  try {
    const list = JSON.parse(execSync("pm2 jlist", { stdio: "pipe", encoding: "utf8" }));
    const p = list.find(x => x.name === PM2_NAME);
    return p?.pm2_env?.status === "online";
  } catch { return false; }
}

function getRedisArgs() {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^\s*REDIS_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n#]*))/m);
    const url = new URL((m?.[1] ?? m?.[2] ?? m?.[3] ?? "redis://127.0.0.1:6379/0").trim());
    const args = ["-h", url.hostname, "-p", url.port || "6379"];
    if (url.password) args.push("-a", url.password);
    const db = url.pathname.replace("/", ""); if (db) args.push("-n", db);
    return args;
  } catch { return ["-h", "127.0.0.1", "-p", "6379"]; }
}

function redis(...cmd) {
  const r = spawnSync("redis-cli", [...getRedisArgs(), ...cmd], { encoding: "utf8", timeout: 5000 });
  return (r.stdout || "").trim();
}

// ─── Lock ───────────────────────────────────────────────────────────────────
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const d = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (Date.now() - d.ts < 300000) return false; // 5 min max
    } catch {}
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ ts: Date.now(), pid: process.pid }));
  return true;
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

// ─── Change Detection ───────────────────────────────────────────────────────
function classify(files) {
  let needsRestart = false, needsDeps = false, reclusterFiles = [], restartFiles = [];
  for (const f of files) {
    if (/package\.json$|yarn\.lock$|\.yarnrc/.test(f)) needsDeps = true;
    if (RESTART_PATTERNS.some(p => p.test(f))) { needsRestart = true; restartFiles.push(f); }
    else if (RECLUSTER_SAFE.some(p => p.test(f))) reclusterFiles.push(f);
  }
  return { needsRestart, needsDeps, reclusterFiles, restartFiles };
}

// ─── Health Check ───────────────────────────────────────────────────────────
function waitHealth(timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = execSync("curl -sf http://127.0.0.1:9090/health", { encoding: "utf8", timeout: 3000 });
      if (r.includes("status")) return true;
    } catch {}
    sleep(2000);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function smartReload({ dryRun = false } = {}) {
  console.log(`\n  ${C.bold}═══ Pull, Build & Smart Reload${dryRun ? " (DRY RUN)" : ""} ═══${C.reset}\n`);

  if (!acquireLock()) { fail("Another deployment is in progress."); return { success: false }; }

  try {
    if (!pm2Ok()) { fail("PM2 not installed. Run: npm i -g pm2"); return { success: false }; }

    // ── Git Pull ─────────────────────────────────────────────────────────
    const prevCommit = run("git rev-parse HEAD").stdout || "unknown";
    info(`Current commit: ${prevCommit.slice(0, 8)}`);

    info("Pulling latest...");
    const pull = run("git pull --ff-only");
    if (!pull.ok) { fail(`Git pull failed: ${pull.stderr?.slice(0, 150)}`); return { success: false }; }

    const newCommit = run("git rev-parse HEAD").stdout || "unknown";
    if (prevCommit === newCommit) { ok("Already up to date."); return { success: true, noChanges: true }; }
    ok(`${prevCommit.slice(0, 8)} → ${newCommit.slice(0, 8)}`);

    // ── Detect Changes ───────────────────────────────────────────────────
    const files = (run(`git diff --name-only ${prevCommit} ${newCommit}`).stdout || "").split("\n").filter(Boolean);
    info(`${files.length} file(s) changed`);
    const cls = classify(files);

    if (cls.reclusterFiles.length) {
      info(`Recluster-safe: ${cls.reclusterFiles.length} (commands/events/components)`);
      cls.reclusterFiles.slice(0, 4).forEach(f => console.log(`    ${C.gray}${f}${C.reset}`));
      if (cls.reclusterFiles.length > 4) console.log(`    ${C.gray}... +${cls.reclusterFiles.length - 4} more${C.reset}`);
    }
    if (cls.restartFiles.length) {
      warn(`Core changes (restart needed): ${cls.restartFiles.length}`);
      cls.restartFiles.slice(0, 3).forEach(f => console.log(`    ${C.yellow}${f}${C.reset}`));
    }

    const method = cls.needsRestart ? "PM2 restart" : "Graceful recluster";
    info(`Deploy method: ${C.bold}${method}${C.reset}`);

    // ── Dry Run Stop ─────────────────────────────────────────────────────
    if (dryRun) {
      ok("Dry run complete. No changes applied.");
      console.log(`\n  Would: ${cls.needsDeps ? "install deps → " : ""}build → ${method.toLowerCase()}`);
      return { success: true, dryRun: true, method, files: files.length };
    }

    // ── Dependencies ─────────────────────────────────────────────────────
    if (cls.needsDeps) {
      info("Installing dependencies...");
      const deps = run("yarn install --frozen-lockfile", { timeout: 120000 });
      if (!deps.ok) { fail("Deps failed. Rolling back."); run(`git reset --hard ${prevCommit}`); return { success: false }; }
      ok("Dependencies installed.");
    }

    // ── Build ────────────────────────────────────────────────────────────
    info("Building...");
    const build = run("yarn build", { timeout: 180000 });
    if (!build.ok) {
      fail("Build failed. Rolling back to previous commit.");
      run(`git reset --hard ${prevCommit}`);
      run("yarn build", { timeout: 180000 }); // rebuild previous
      return { success: false, reason: "Build failed" };
    }
    if (!fs.existsSync(BOT_ENTRY)) {
      fail("Build output missing. Rolling back.");
      run(`git reset --hard ${prevCommit}`); run("yarn build", { timeout: 180000 });
      return { success: false, reason: "No dist output" };
    }
    ok("Build validated.");

    // ── Deploy ───────────────────────────────────────────────────────────
    const botUp = pm2Running();

    if (!cls.needsRestart && botUp) {
      // GRACEFUL RECLUSTER — discord-hybrid-sharding spawns new workers with new code
      // Triggered by PM2 reload which restarts the cluster manager, which re-spawns workers
      // with the updated dist/ — the ReClusterManager gracefulSwitch handles transition
      info("Triggering graceful reload (PM2 reload → new workers with updated code)...");
      const reload = run(`pm2 reload ${PM2_NAME}`);
      if (!reload.ok) {
        warn("PM2 reload failed, trying restart...");
        run(`pm2 restart ${PM2_NAME}`);
      }
      sleep(5000);
      if (waitHealth(30000)) {
        ok("Graceful reload complete. New code is live.");
      } else {
        warn("Health check slow after reload. Bot may still be starting.");
      }

    } else {
      // FULL RESTART — core files changed
      if (botUp) {
        // Signal workers to save music state via Redis command key
        info("Saving music state before restart...");
        redis("SET", REDIS_DEPLOY_CMD, "save_music", "EX", "15");
        sleep(4000); // Give workers time to see the key and save

        const saved = redis("GET", REDIS_MUSIC_KEY);
        if (saved && saved !== "(nil)" && saved.length > 5) {
          ok("Music sessions saved to Redis.");
        } else {
          info("No active music sessions (or save completed with 0 players).");
        }
      }

      info("Performing PM2 restart...");
      run(`pm2 stop ${PM2_NAME}`);
      sleep(2000);
      run(`pm2 delete ${PM2_NAME} 2>/dev/null`);
      const start = run(`pm2 start ${ECOSYSTEM} --env production`);
      if (!start.ok) {
        fail("PM2 start failed! Rolling back...");
        run(`git reset --hard ${prevCommit}`); run("yarn build", { timeout: 180000 });
        run(`pm2 start ${ECOSYSTEM} --env production`);
        return { success: false, reason: "PM2 start failed" };
      }

      info("Waiting for health...");
      if (waitHealth(45000)) {
        ok("Bot is healthy.");
        run("pm2 save");
        // Bot will auto-restore music from Redis on startup (8s after ready)
        info("Music sessions will be restored automatically after Lavalink connects.");
      } else {
        fail("Health check failed! Rolling back...");
        run(`pm2 stop ${PM2_NAME}`);
        run(`git reset --hard ${prevCommit}`); run("yarn build", { timeout: 180000 });
        run(`pm2 start ${ECOSYSTEM} --env production`);
        return { success: false, reason: "Health failed after restart" };
      }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────
    redis("DEL", REDIS_DEPLOY_CMD);
    redis("DEL", REDIS_DEPLOY_ACK);

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n  ${C.bold}${C.green}═══ Deployment Successful ═══${C.reset}\n`);
    ok(`${prevCommit.slice(0, 8)} → ${newCommit.slice(0, 8)}`);
    ok(`${files.length} files changed`);
    ok(`Method: ${method}`);
    if (cls.reclusterFiles.length) ok(`Hot-reloaded: ${cls.reclusterFiles.length} modules`);
    if (cls.restartFiles.length) ok(`Core changes: ${cls.restartFiles.length} (triggered restart)`);
    console.log(`\n  ${C.gray}Near-seamless recovery. Music resumes after ~10s if Lavalink sessions are active.${C.reset}\n`);

    return { success: true, method, files: files.length, hotReloaded: cls.reclusterFiles.length, restarted: cls.needsRestart };

  } finally { releaseLock(); }
}

module.exports = { smartReload };

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  smartReload({ dryRun }).then(r => { if (!r.success) process.exit(1); }).catch(e => { fail(e.message); releaseLock(); process.exit(1); });
}
