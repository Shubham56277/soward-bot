import "reflect-metadata";
import { env } from "@repo/env";
import BaseClient from "./base/Client";
import { createREST } from "@repo/framework";
import Redis from "ioredis";
import Logger from "./lib/Logger";
import { startHealthServer, stopHealthServer, markBotReady, getLatencyMonitor, type HealthClientState } from "./modules/health";

const logger = new Logger();
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 9090;

export const rest = createREST({
    //api: https://github.com/twilight-rs/http-proxy in future
    globalRequestsPerSecond: 15,
});

let client: BaseClient | null = null;

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

        // Start health server early so deployments can check liveness
        startHealthServer(HEALTH_PORT, getHealthState);
        logStep("health server started");

        logStep("login starting");
        await client.start(env.DISCORD_APP_TOKEN);
        logStep("client.start resolved");

        // Track ready event for health
        client.once("ready", () => {
            markBotReady();
            logger.success(`[bot-entry] Discord READY: ${client?.user?.tag} | Guilds: ${client?.guilds.cache.size} | Gateway ping: ${client?.ws.ping}ms`);
        });

        // Record gateway ping samples
        setInterval(() => {
            if (client?.ws.ping && client.ws.ping > 0) {
                getLatencyMonitor()?.recordGatewayPing(client.ws.ping);
            }
        }, 10_000);

        // Track shard reconnection events for latency monitor
        client.on("shardReconnecting", () => {
            getLatencyMonitor()?.recordReconnect();
        });
        client.on("shardResume", () => {
            getLatencyMonitor()?.recordResume();
        });

        logStep("bot is now running");
    } catch (error) {
        logger.error("[bot-entry] startup failed:");
        logger.error(error instanceof Error ? error.stack || error.message : String(error));
        process.exit(1);
    }
})();

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

    let redisHealthy = false;
    try {
        redisHealthy = client.redis?.status === "ready";
    } catch {}

    let lavalinkHealthy: boolean | null = null;
    try {
        const nodes = client.manager?.nodeManager?.nodes;
        if (nodes && nodes.size > 0) {
            lavalinkHealthy = [...nodes.values()].some((n: any) => n.connected);
        }
    } catch {}

    return {
        discordConnected: client.ws?.status === 0, // Status.Ready
        discordReady: client.isReady(),
        gatewayPing: client.ws?.ping > 0 ? client.ws.ping : null,
        guildCount: client.guilds?.cache.size ?? null,
        shardCount: client.ws?.shards?.size ?? null,
        databaseHealthy: true, // Pool stays connected; failures surface per-query
        redisHealthy,
        lavalinkHealthy,
    };
}

// ─────────────────────────────────────────────────────────
// 💥 Anti-crash / Error Boundary
// ─────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: unknown, promise: Promise<any>) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("rejectionHandled", (promise: Promise<any>) => {
    logger.warn("Promise rejection was handled asynchronously:", promise);
});

process.on("uncaughtException", (err: Error) => {
    logger.error("Uncaught Exception thrown:", err);
    // Non-recoverable: exit so systemd restarts us
    process.exit(1);
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

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(`[shutdown] Received ${signal}, shutting down gracefully...`);

    // Stop health server
    stopHealthServer();

    // Destroy Discord client
    if (client) {
        try {
            client.destroy();
            logger.info("[shutdown] Discord client destroyed.");
        } catch (err) {
            logger.error("[shutdown] Error destroying client:", err);
        }
    }

    // Allow a moment for cleanup
    setTimeout(() => {
        logger.info("[shutdown] Exiting.");
        process.exit(0);
    }, 2000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─────────────────────────────────────────────────────────

declare module "discord.js" {
    interface Client {
        redis: Redis;
    }
}
