import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { LatencyMonitor } from "./latencyMonitor";

interface ActiveHealthServer {
    server: Server;
    monitor: LatencyMonitor;
    requestListener: RequestListener;
    errorListener: (error: Error) => void;
}

let activeHealthServer: ActiveHealthServer | null = null;
let healthLifecycleTail: Promise<void> = Promise.resolve();
let botReadyTime: number | null = null;
let botStartTime: number | null = null;
const gitCommit = getBuildCommit();

export function getLatencyMonitor(): LatencyMonitor | null {
    return activeHealthServer?.monitor ?? null;
}

export function markBotReady(): void {
    botReadyTime = Date.now();
}

function serializeHealthLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = healthLifecycleTail.then(operation, operation);
    healthLifecycleTail = result.then(() => undefined, () => undefined);
    return result;
}

export function startHealthServer(port: number, getClientState: () => HealthClientState): Promise<void> {
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        return Promise.reject(new RangeError(`Invalid health server port: ${port}`));
    }

    return serializeHealthLifecycle(async () => {
        if (activeHealthServer) return;

        const monitor = new LatencyMonitor();
        const requestListener: RequestListener = (req, res) => handleRequest(req, res, getClientState);
        const server = createServer();
        server.on("request", requestListener);
        const errorListener = (error: Error): void => {
            console.error("[health] Health server error:", error.message);
            void stopHealthServer().catch((stopError) => console.error("[health] Failed to stop health server:", stopError));
        };

        activeHealthServer = { server, monitor, requestListener, errorListener };
        botStartTime = Date.now();
        botReadyTime = null;

        try {
            await listenOnLoopback(server, port, errorListener);
            console.log(`[health] Health server listening on 127.0.0.1:${port}`);
        } catch (error) {
            if (activeHealthServer?.server === server) activeHealthServer = null;
            botStartTime = null;
            botReadyTime = null;
            monitor.destroy();
            server.off("request", requestListener);
            server.off("error", errorListener);
            await closeServer(server).catch((closeError) => {
                console.error("[health] Failed to close health server after startup failure:", closeError);
            });
            server.removeAllListeners();
            if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
                console.error(`[health] Port ${port} is already in use; health server was not started.`);
            }
            throw error;
        }
    });
}

export function stopHealthServer(): Promise<void> {
    return serializeHealthLifecycle(async () => {
        const active = activeHealthServer;
        if (!active) {
            botStartTime = null;
            botReadyTime = null;
            return;
        }

        activeHealthServer = null;
        botStartTime = null;
        botReadyTime = null;
        active.monitor.destroy();
        active.server.off("error", active.errorListener);
        active.server.off("request", active.requestListener);
        try {
            await closeServer(active.server);
        } finally {
            active.server.removeAllListeners();
        }
    });
}

function listenOnLoopback(server: Server, port: number, runtimeErrorListener: (error: Error) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanupStartupListeners = (): void => {
            server.off("error", onStartupError);
            server.off("listening", onListening);
        };
        const onStartupError = (error: Error): void => {
            if (settled) return;
            settled = true;
            cleanupStartupListeners();
            reject(error);
        };
        const onListening = (): void => {
            if (settled) return;
            settled = true;
            cleanupStartupListeners();
            server.on("error", runtimeErrorListener);
            resolve();
        };

        server.once("error", onStartupError);
        server.once("listening", onListening);
        try {
            server.listen(port, "127.0.0.1");
        } catch (error) {
            onStartupError(error as Error);
        }
    });
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) return;
    const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
            else resolve();
        });
    });
    server.closeAllConnections();
    await closed;
}

function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    getClientState: () => HealthClientState,
): void {
    if (req.method !== "GET") {
        res.writeHead(405);
        res.end("Method Not Allowed");
        return;
    }

    try {
        switch (req.url || "/") {
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
    } catch (error) {
        console.error("[health] Request failed:", error);
        res.writeHead(500);
        res.end("Internal Server Error");
    }
}

function getBuildCommit(): string {
    const candidates = [
        process.env.BUILD_COMMIT,
        process.env.GIT_COMMIT,
        process.env.SOURCE_VERSION,
        process.env.RAILWAY_GIT_COMMIT_SHA,
        process.env.RENDER_GIT_COMMIT,
        process.env.VERCEL_GIT_COMMIT_SHA,
    ];
    const commit = candidates.find((value): value is string => Boolean(value && /^[a-f\d]{7,64}$/i.test(value)));
    return commit?.slice(0, 12) ?? "unknown";
}

function handleHealth(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    const monitor = activeHealthServer?.monitor ?? null;
    const uptimeSeconds = botStartTime === null ? 0 : Math.floor((Date.now() - botStartTime) / 1000);
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const gatewayStats = monitor?.getGatewayStats() ?? null;
    const eventLoopStats = monitor?.getEventLoopStats() ?? null;

    const body = {
        status: state.discordReady ? "healthy" : "starting",
        ready: state.discordReady,
        discord: {
            connected: state.discordConnected,
            ready: state.discordReady,
            gatewayPingMs: state.gatewayPing,
            gatewayPingAverageMs: gatewayStats?.average ?? null,
            gatewayPingP95Ms: gatewayStats?.p95 ?? null,
            reconnects: monitor?.reconnectCount ?? 0,
            resumes: monitor?.resumeCount ?? 0,
        },
        eventLoop: {
            meanMs: eventLoopStats?.mean ?? null,
            p95Ms: eventLoopStats?.p95 ?? null,
            p99Ms: eventLoopStats?.p99 ?? null,
        },
        process: {
            uptimeSeconds,
            startupDurationMs: botReadyTime !== null && botStartTime !== null ? botReadyTime - botStartTime : null,
            memoryMb: Math.round(memUsage.rss / 1024 / 1024),
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            cpuUser: cpuUsage.user,
            cpuSystem: cpuUsage.system,
            pid: process.pid,
        },
        dependencies: {
            database: state.databaseHealthy ? "healthy" : "unhealthy",
            redis: state.redisHealthy ? "healthy" : "unhealthy",
            lavalink: state.lavalinkHealthy ? "healthy" : state.lavalinkHealthy === null ? "unknown" : "unhealthy",
        },
        shards: state.shardCount ?? null,
        guilds: state.guildCount ?? null,
        version: { commit: gitCommit, node: process.version },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function handleReady(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    const ready = state.discordReady && state.databaseHealthy && state.redisHealthy;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ready ? { ready: true } : {
        ready: false,
        dependencies: {
            discord: state.discordReady,
            database: state.databaseHealthy,
            redis: state.redisHealthy,
        },
    }));
}

function handleMetrics(res: ServerResponse, getClientState: () => HealthClientState): void {
    const state = getClientState();
    const monitor = activeHealthServer?.monitor ?? null;
    const memUsage = process.memoryUsage();
    const uptimeSeconds = botStartTime === null ? 0 : Math.floor((Date.now() - botStartTime) / 1000);
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
