import "reflect-metadata";
import { env } from "@repo/env";
import BaseClient from "./base/Client";
import { createREST } from "@repo/framework";
import Redis from "ioredis";


export const rest = createREST({
    //api: https://github.com/twilight-rs/http-proxy in future
    globalRequestsPerSecond: 15,
});

(async () => {
    const client = new BaseClient();
    client.rest = rest;
    await client.start(env.DISCORD_APP_TOKEN);
})();
// ─────────────────────────────────────────────────────────
// 💥 Anti-crash / Error Boundary
// ─────────────────────────────────────────────────────────

process.on("unhandledRejection", (reason: unknown, promise: Promise<any>) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    // Optional: shut down process
    // process.exit(1);
});

process.on("rejectionHandled", (promise: Promise<any>) => {
    console.warn("⚠️ Promise rejection was handled asynchronously:", promise);
});

process.on("uncaughtException", (err: Error) => {
    console.error("💥 Uncaught Exception thrown:", err);
    // Optional: shut down process
    // process.exit(1);
});

process.on("uncaughtExceptionMonitor", (err: Error) => {
    console.error("📡 uncaughtExceptionMonitor triggered:", err);
});


process.on("warning", (warning) => {
    console.warn("⚠️ Node.js Warning:", warning);
});

// ─────────────────────────────────────────────────────────

declare module "discord.js" {
    interface Client {
        redis: Redis;
    }
}
