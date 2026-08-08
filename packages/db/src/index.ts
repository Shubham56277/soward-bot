import { env } from "@repo/env";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

if (!env.DATABASE_URI) {
	throw new Error("DATABASE_URI is required to initialize the database");
}

export const pool = new Pool({
	connectionString: env.DATABASE_URI,
});
export const db = drizzle({ client: pool, schema });

/** Close the shared PostgreSQL pool during graceful application shutdown. */
export async function closeDatabase(): Promise<void> {
	await pool.end();
}

export * from "./classes";
export * from "./cache";
export * from "./types";
export * from "drizzle-orm";
export { schema };
