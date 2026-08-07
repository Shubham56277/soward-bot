import "reflect-metadata";
import { env } from "@repo/env";
import { closeDatabase, pool } from "@repo/db";
import BaseClient from "./base/Client";
import { createREST } from "@repo/framework";
import Redis from "ioredis";
import Logger from "./lib/Logger";
import { startHealthServer, stopHealthServer, markBotReady, getLatencyMonitor, type HealthClientState } from "./modules/health";
import { handleProcessError } from "./utils/errorHandler";
import { shutdownQueues } from "./queues";
import { installHotReloadHandlers, restoreMusicSessions } from "./modules/hotReload";

const logger = new Logger();
const configuredHealthPort = process.env.HEALTH_PORT === undefined ? 9090 : Number(process.env.HEALTH_PORT);
const DATABASE_HEALTH_INTERVAL_MS = 30_000;

export const rest = createREST({
    //api: https://github.com/twilight-rs/http-proxy in future
    globalRequestsPerSecond: 15,
});

let client: BaseClient | null = null;
let musicRestoreTimer: NodeJS.Timeout | null = null;
let gatewayPingTimer: NodeJS.Timeout | null = null;
let databaseHealthTimer: NodeJS.Timeout | null = null;
let databaseProbe: Promise<void> | null = null;
let databaseHealthy = false;
let databaseHealthInitialized = false;
let onClientReady: (() => void) | null = null;
let onShardReconnecting: (() => void) | null = null;
let onShardResume: (() => void) | null = null;
let shuttingDown = false;

(async () => {
    const logStep = (message: string) => logger.start(`[bot-entry] ${message}`);
    try {
        logStep("module loaded");
        logStep("environment validation:");
        logger.info(`  DISCORD_APP_TOKEN: ${env.DISCORD_APP_TOKEN ? "present" : "MISSING"}`);
        logger.info(`  DISCORD_APP_CLIENT_ID: ${env.DISCORD_APP_CLIENT_ID ? "present" : "MISSING"}`);
        logger.info(`  REDIS_URL: ${env.REDIS_URL ? "present" : "MISSING"}`);
        logger.info(`  DATABASE_URI: ${env.DATABASE_URI ? "present" : "MISSING"}`);
        logger.info(`  NODE_ENV: ${env.NODE_ENV ?? "not set"}`);
        logger.info(`  NODES (Lavalink): ${env.NODES?.length ?? 0} configured`);

        if (!env.DISCORD_APP_TOKEN) {
            logger.error("[bot-entry] DISCORD_APP_TOKEN is missing. Cannot start.");
            process.exit(1);
        }

        client = new BaseClient();
        logStep("BaseClient constructed");
        client.rest = rest;
        logStep("REST client attached");

        // Start health server early so deployments can check liveness.
        await startHealthServer(configuredHealthPort, getHealthState);
        logStep("health server started");

        let readyHandled = false;
        onClientReady = () => {
            if (readyHandled || shuttingDown) return;
            readyHandled = true;
            markBotReady();
            logger.success(`[bot-entry] Discord READY: ${client?.user?.tag} | Guilds: ${client?.guilds.cache.size} | Gateway ping: ${client?.ws.ping}ms`);

            musicRestoreTimer = setTimeout(() => {
                musicRestoreTimer = null;
                const currentClient = client;
                if (!currentClient || shuttingDown) return;
                restoreMusicSessions(currentClient).then(({ restored, failed }) => {
                    if (restored > 0) logger.success(`[bot-entry] Restored ${restored} music session(s) from pre-restart save.`);
                    if (failed > 0) logger.warn(`[bot-entry] Failed to restore ${failed} music session(s).`);
                }).catch(err => logger.warn("[bot-entry] Music restore skipped:", err));
            }, 8000);
            musicRestoreTimer.unref();
        };
        client.once("clientReady", onClientReady);

        await refreshDatabaseHealth();
        startDatabaseHealthMonitor();

        logStep("login starting");
        await client.start(env.DISCORD_APP_TOKEN);
        logStep("client.start resolved");
        if (client.isReady()) onClientReady();

        // Install hot-reload signal handlers
        installHotReloadHandlers(client);
        logStep("hot-reload handlers installed");

        // Record gateway ping samples
        gatewayPingTimer = setInterval(() => {
            const ping = client?.ws.ping;
            if (typeof ping === "number" && Number.isFinite(ping) && ping > 0) {
                getLatencyMonitor()?.recordGatewayPing(ping);
            }
        }, 10_000);
        gatewayPingTimer.unref();

        // Track shard reconnection events for latency monitor
        onShardReconnecting = () => getLatencyMonitor()?.recordReconnect();
        onShardResume = () => getLatencyMonitor()?.recordResume();
        client.on("shardReconnecting", onShardReconnecting);
        client.on("shardResume", onShardResume);

        logStep("bot is now running");
    } catch (error) {
        logger.error("[bot-entry] startup failed:");
        logger.error(error instanceof Error ? error.stack || error.message : String(error));
        shuttingDown = true;
        await cleanupResources("startup failure");
        process.exit(1);
    }
})();

async function refreshDatabaseHealth(): Promise<void> {
    if (databaseProbe) return databaseProbe;

    const probe = (async () => {
        try {
            // node-postgres supports per-query timeouts at runtime; its bundled overload omits this option.
            await pool.query({ text: "SELECT 1", query_timeout: 5_000 } as any);
            if (databaseHealthInitialized && !databaseHealthy) logger.info("[health] Database connection recovered.");
            databaseHealthy = true;
        } catch (error) {
            if (!databaseHealthInitialized || databaseHealthy) logger.error("[health] Database health check failed:", error);
            databaseHealthy = false;
        } finally {
            databaseHealthInitialized = true;
        }
    })();

    databaseProbe = probe;
    try {
        await probe;
    } finally {
        if (databaseProbe === probe) databaseProbe = null;
    }
}

function startDatabaseHealthMonitor(): void {
    if (databaseHealthTimer) return;
    databaseHealthTimer = setInterval(() => {
        if (!shuttingDown) void refreshDatabaseHealth();
    }, DATABASE_HEALTH_INTERVAL_MS);
    databaseHealthTimer.unref();
}

function getHealthState(): HealthClientState {
    if (!client) {
        return {
            discordConnected: false,
            discordReady: false,
            gatewayPing: null,
            guildCount: null,
            shardCount: null,
            databaseHealthy: false,
            redisHealthy: false,
            lavalinkHealthy: null,
        };
    }

    const redisHealthy = client.redis?.status === "ready";
    const nodes = client.manager?.nodeManager?.nodes;
    const lavalinkHealthy = nodes && nodes.size > 0
        ? [...nodes.values()].some((node: { connected?: boolean }) => node.connected === true)
        : null;

    return {
        discordConnected: client.ws?.status === 0, // Status.Ready
        discordReady: client.isReady(),
        gatewayPing: client.ws?.ping > 0 ? client.ws.ping : null,
        guildCount: client.guilds?.cache.size ?? null,
        shardCount: client.ws?.shards?.size ?? null,
        databaseHealthy,
        redisHealthy,
        lavalinkHealthy,
    };
}

// ─────────────────────────────────────────────────────────
// Anti-crash / Error Boundary
// ─────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: unknown, promise: Promise<any>) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    void handleProcessError(client, reason, "unhandledRejection");
});

process.on("rejectionHandled", (promise: Promise<any>) => {
    logger.warn("Promise rejection was handled asynchronously:", promise);
});

process.on("uncaughtException", (err: Error) => {
    logger.error("Uncaught Exception thrown:", err);
    const forcedExit = setTimeout(() => process.exit(1), 15_000);
    void handleProcessError(client, err, "uncaughtException")
        .catch((alertError) => logger.error("[shutdown] Failed to report uncaught exception:", alertError))
        .finally(async () => {
            if (!shuttingDown) {
                shuttingDown = true;
                await cleanupResources("uncaught exception");
            }
            clearTimeout(forcedExit);
            process.exit(1);
        });
});

process.on("uncaughtExceptionMonitor", (err: Error) => {
    logger.error("uncaughtExceptionMonitor triggered:", err);
});

process.on("warning", (warning) => {
    logger.warn("Node.js Warning:", warning);
});

// ─────────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────────

async function cleanupResources(context: string): Promise<boolean> {
    const failures: Array<{ step: string; error: unknown }> = [];
    const runStep = async (step: string, operation: () => Promise<void>): Promise<void> => {
        try {
            await operation();
            logger.info(`[${context}] ${step} complete.`);
        } catch (error) {
            failures.push({ step, error });
            logger.error(`[${context}] ${step} failed:`, error);
        }
    };

    if (musicRestoreTimer) {
        clearTimeout(musicRestoreTimer);
        musicRestoreTimer = null;
    }
    if (gatewayPingTimer) {
        clearInterval(gatewayPingTimer);
        gatewayPingTimer = null;
    }
    if (databaseHealthTimer) {
        clearInterval(databaseHealthTimer);
        databaseHealthTimer = null;
    }

    const currentClient = client;
    if (currentClient) {
        if (onClientReady) currentClient.off("clientReady", onClientReady);
        if (onShardReconnecting) currentClient.off("shardReconnecting", onShardReconnecting);
        if (onShardResume) currentClient.off("shardResume", onShardResume);
    }
    onClientReady = null;
    onShardReconnecting = null;
    onShardResume = null;

    await runStep("Health server shutdown", stopHealthServer);
    if (databaseProbe) await runStep("Database health probe drain", () => databaseProbe ?? Promise.resolve());
    await runStep("BullMQ shutdown", shutdownQueues);
    if (currentClient) {
        await runStep("Discord client shutdown", () => currentClient.destroy());
        if (currentClient.redis && currentClient.redis.status !== "end") {
            await runStep("Redis shutdown fallback", () => currentClient.redis.quit().then(() => undefined));
        }
    }
    await runStep("Database shutdown", closeDatabase);
    client = null;

    if (failures.length > 0) {
        logger.error(`[${context}] Cleanup completed with ${failures.length} failure(s): ${failures.map(({ step }) => step).join(", ")}`);
        return false;
    }
    return true;
}

async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(`[shutdown] Received ${signal}, shutting down gracefully...`);
    const forcedExit = setTimeout(() => {
        logger.error("[shutdown] Cleanup exceeded 15 seconds; forcing exit.");
        process.exit(1);
    }, 15_000);

    const clean = await cleanupResources("shutdown");
    clearTimeout(forcedExit);
    logger.info(`[shutdown] Exiting with code ${clean ? 0 : 1}.`);
    process.exit(clean ? 0 : 1);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// ─────────────────────────────────────────────────────────

declare module "discord.js" {
    interface Client {
        redis: Redis;
    }
}
