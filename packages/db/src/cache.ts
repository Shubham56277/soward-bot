export interface CacheClient {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, expiryMode: "EX", ttlSeconds: number): Promise<unknown>;
	del(...keys: string[]): Promise<unknown>;
}

let client: CacheClient | undefined;
const inFlight = new Map<string, Promise<unknown>>();

export function configureCache(cacheClient?: CacheClient) {
	client = cacheClient;
}

export async function invalidateCache(...keys: string[]) {
	if (!client || keys.length === 0) return;

	try {
		await client.del(...keys);
	} catch {
		// Redis is an optimization. Database writes must remain available if it is down.
	}
}

export async function cacheAside<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
	const cacheClient = client;
	if (!cacheClient || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) return load();

	try {
		const cached = await cacheClient.get(key);
		if (cached !== null) return JSON.parse(cached) as T;
	} catch {
		// Treat cache read and deserialization failures as misses.
	}

	const pending = inFlight.get(key) as Promise<T> | undefined;
	if (pending) return pending;

	const request = load()
		.then(async (value) => {
			try {
				const serialized = JSON.stringify(value);
				if (serialized !== undefined) await cacheClient.set(key, serialized, "EX", ttlSeconds);
			} catch {
				// Serve the database result even when Redis is unavailable.
			}
			return value;
		})
		.finally(() => inFlight.delete(key));

	inFlight.set(key, request);
	return request;
}
