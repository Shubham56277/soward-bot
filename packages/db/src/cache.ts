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
	if (!client) return load();

	try {
		const cached = await client.get(key);
		if (cached !== null) return JSON.parse(cached) as T;
	} catch {
		return load();
	}

	const pending = inFlight.get(key) as Promise<T> | undefined;
	if (pending) return pending;

	const request = load()
		.then(async (value) => {
			try {
				await client?.set(key, JSON.stringify(value), "EX", ttlSeconds);
			} catch {
				// Serve the database result even when Redis is unavailable.
			}
			return value;
		})
		.finally(() => inFlight.delete(key));

	inFlight.set(key, request);
	return request;
}
