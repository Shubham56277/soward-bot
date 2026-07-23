import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { LatencyMonitor } from "./latencyMonitor";

let healthServer: ReturnType<typeof createServer> | null = null;
let latencyMonitor: LatencyMonitor | null = null;
let botReadyTime: number | null = null;
let botStartTime = Date.now();

export function getLatencyMonitor(): LatencyMonitor | null {
    return latencyMonitor;
}

export function markBotReady(): void {
    botReadyTime = Date.now();
}

export function startHealthServer(port: number, getClientState: () => HealthClientState): void {
    if (healthServer) return;

    latencyMonitor = new LatencyMonitor();

    healthServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || "/";

        if (req.method !== "GET") {
            res.writeHead(405);
            res.end("Method Not Allowed");
            return;
        }

        try {
            switch (url) {
                case "/health":
                    handleHealth(res, getClientState);
                    break;
                case "/ready":
                    handleReady(res, getClientState);
                    break;
                case "/metrics":
                    handleMetrics(res, getClientState);
                    break;
                default:
                    res.writeHead(404);
                    res.end("Not Found");
            }
        } catch (err) {
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    });

    // Bind to localhost only
    healthServer.listen(port, "127.0.0.1", () => {
        console.log(`[health] Health server listening on 127.0.0.1:${port}`);
    });

    healthServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
            console.warn(`[health] Port ${port} in use, trying ${port + 1}`);
            healthServer?.close();
            healthServer = null;
            startHealthServer(port + 1, getClientState);
        } else {
            console.error("[health] Health server error:", err.message);
        }
    });
}

export function stopHealthServer(): void {
    if (healthServer) {
        healthServer.close();
        healthServer = null;
    }
    if (latencyMonitor) {
        latencyMonitor.destroy();
        latencyMonitor = null;
    }
}

function getGitCommit(): string {
    try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf-8", timeout: 3000 }).trim();
    } catch {
        return "unknown";
    }
}

function handleHealth(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    const monitor = latencyMonitor;
    const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);
    const memUsage = process.memoryUsage();

    const body = {
        status: state.discordReady ? "healthy" : "starting",
        ready: state.discordReady,
        discord: {
            connected: state.discordConnected,
            ready: state.discordReady,
            gatewayPingMs: state.gatewayPing,
            gatewayPingAverageMs: monitor?.getGatewayStats().average ?? null,
            gatewayPingP95Ms: monitor?.getGatewayStats().p95 ?? null,
            reconnects: monitor?.reconnectCount ?? 0,
            resumes: monitor?.resumeCount ?? 0,
        },
        eventLoop: {
            meanMs: monitor?.getEventLoopStats().mean ?? null,
            p95Ms: monitor?.getEventLoopStats().p95 ?? null,
            p99Ms: monitor?.getEventLoopStats().p99 ?? null,
        },
        process: {
            uptimeSeconds,
            startupDurationMs: botReadyTime ? botReadyTime - botStartTime : null,
            memoryMb: Math.round(memUsage.rss / 1024 / 1024),
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            cpuUser: process.cpuUsage().user,
            cpuSystem: process.cpuUsage().system,
            pid: process.pid,
        },
        dependencies: {
            database: state.databaseHealthy ? "healthy" : "unhealthy",
            redis: state.redisHealthy ? "healthy" : "unhealthy",
            lavalink: state.lavalinkHealthy ? "healthy" : state.lavalinkHealthy === null ? "unknown" : "unhealthy",
        },
        shards: state.shardCount ?? null,
        guilds: state.guildCount ?? null,
        version: {
            commit: getGitCommit(),
            node: process.version,
        },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function handleReady(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    if (state.discordReady) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: true }));
    } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: false }));
    }
}

function handleMetrics(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    const monitor = latencyMonitor;
    const memUsage = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);

    const metrics = {
        gateway: monitor?.getGatewayStats() ?? null,
        eventLoop: monitor?.getEventLoopStats() ?? null,
        process: {
            uptimeSeconds,
            rssBytes: memUsage.rss,
            heapUsedBytes: memUsage.heapUsed,
            heapTotalBytes: memUsage.heapTotal,
            externalBytes: memUsage.external,
            cpu: process.cpuUsage(),
        },
        discord: {
            gatewayPing: state.gatewayPing,
            guildCount: state.guildCount,
            shardCount: state.shardCount,
            reconnects: monitor?.reconnectCount ?? 0,
            resumes: monitor?.resumeCount ?? 0,
        },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(metrics));
}

export interface HealthClientState {
    discordConnected: boolean;
    discordReady: boolean;
    gatewayPing: number | null;
    guildCount: number | null;
    shardCount: number | null;
    databaseHealthy: boolean;
    redisHealthy: boolean;
    lavalinkHealthy: boolean | null;
}
