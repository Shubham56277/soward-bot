import { env } from "@repo/env";
import * as schema from "./schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
	connectionString: env.DATABASE_URI!,
});
export const db = drizzle({ client: pool, schema });

export * from "./classes";
export * from "./cache";
export * from "./types";
export * from "drizzle-orm";
export { schema };
