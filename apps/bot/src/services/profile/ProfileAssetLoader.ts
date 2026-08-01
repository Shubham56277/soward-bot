import { lookup } from "node:dns/promises";
import { realpath, readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Agent, request } from "undici";
import type { BadgeAsset } from "@repo/db";
import { isPrivateAddress, isPrivateHostname } from "../../utils/botSettingsValidation";

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const CACHE_TTL_MS = 2 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 7_500;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT = 128;
const DISCORD_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type CacheEntry = { expiresAt: number; value: Promise<Buffer | null>; bytes: number; settled: boolean };
export type ProfileAssetSource = string | Buffer | Uint8Array | null | undefined;

export interface ProfileAssetCacheOptions {
	maxBytes?: number;
	maxEntries?: number;
	successTtlMs?: number;
	negativeTtlMs?: number;
	now?: () => number;
}

function isImageBuffer(buffer: Buffer): boolean {
	if (buffer.length < 12) return false;
	return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
		|| buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
		|| buffer.subarray(0, 6).toString("ascii") === "GIF87a"
		|| buffer.subarray(0, 6).toString("ascii") === "GIF89a"
		|| (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP");
}

export function isOfficialDiscordAssetUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
			|| !DISCORD_HOSTS.has(url.hostname.toLowerCase())) return false;
		const expectedPath = /^\/(?:avatars|banners)\/\d{17,20}\/[a-zA-Z0-9_]+\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)
			|| /^\/embed\/avatars\/[0-5]\.png$/i.test(url.pathname);
		if (!expectedPath) return false;
		for (const [key, valuePart] of url.searchParams) {
			if (key !== "size" || !/^(?:16|32|64|128|256|512|1024|2048|4096)$/.test(valuePart)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Discord marks animated avatar/banner hashes with `a_`; GIF URLs are animated too. */
export function isAnimatedDiscordAsset(value: string | null | undefined): boolean {
	if (!value) return false;
	return value.startsWith("a_") || /\.gif(?:$|[?#])/i.test(value);
}

export class ProfileAssetLoader {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly imagesRoot: string;
	private readonly maxCacheBytes: number;
	private readonly maxCacheEntries: number;
	private readonly successTtlMs: number;
	private readonly negativeTtlMs: number;
	private readonly now: () => number;
	private cacheBytes = 0;

	public constructor(imagesRoot = path.resolve(__dirname, "..", "..", "..", "images"), options: ProfileAssetCacheOptions = {}) {
		this.imagesRoot = imagesRoot;
		this.maxCacheBytes = Math.max(1, Math.min(options.maxBytes ?? CACHE_MAX_BYTES, 64 * 1024 * 1024));
		this.maxCacheEntries = Math.max(1, Math.min(options.maxEntries ?? CACHE_LIMIT, 256));
		this.successTtlMs = options.successTtlMs ?? CACHE_TTL_MS;
		this.negativeTtlMs = options.negativeTtlMs ?? NEGATIVE_CACHE_TTL_MS;
		this.now = options.now ?? Date.now;
	}

	public loadDiscord(source: ProfileAssetSource): Promise<Buffer | null> {
		if (source instanceof Uint8Array) return this.fromBuffer(source);
		if (!source || !isOfficialDiscordAssetUrl(source)) return Promise.resolve(null);
		return this.cached(`discord:${source}`, () => this.fetchRemote(source, true));
	}

	public loadBadge(asset: BadgeAsset | ProfileAssetSource): Promise<Buffer | null> {
		if (asset instanceof Uint8Array) return this.fromBuffer(asset);
		if (!asset) return Promise.resolve(null);
		if (typeof asset === "string") {
			if (/^https:/i.test(asset)) return this.cached(`remote:${asset}`, () => this.fetchRemote(asset, false));
			return this.cached(`local:${asset}`, () => this.readLocal(asset));
		}
		return asset.kind === "remote"
			? this.cached(`remote:${asset.url}`, () => this.fetchRemote(asset.url, false))
			: this.cached(`local:${asset.path}`, () => this.readLocal(asset.path));
	}

	public async isSafeBadgeAsset(asset: BadgeAsset): Promise<boolean> {
		return (await this.loadBadge(asset)) !== null;
	}

	public clear(): void {
		this.cache.clear();
		this.cacheBytes = 0;
	}

	public cacheState(): Readonly<{ entries: number; bytes: number }> {
		return { entries: this.cache.size, bytes: this.cacheBytes };
	}

	private removeCacheEntry(key: string, entry: CacheEntry): void {
		if (this.cache.get(key) !== entry) return;
		this.cache.delete(key);
		this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
	}

	private evict(excludeKey?: string): void {
		while (this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes) {
			// Never evict unresolved work: callers for the same key must retain promise deduplication.
			const candidate = [...this.cache.entries()].find(([key, entry]) => key !== excludeKey && entry.settled);
			if (!candidate) break;
			this.removeCacheEntry(candidate[0], candidate[1]);
		}
		const own = excludeKey ? this.cache.get(excludeKey) : undefined;
		if (own?.settled && (own.bytes > this.maxCacheBytes || this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes)) {
			this.removeCacheEntry(excludeKey!, own);
		}
	}

	private fromBuffer(value: Uint8Array): Promise<Buffer | null> {
		const buffer = Buffer.from(value);
		return Promise.resolve(buffer.length <= MAX_BYTES && isImageBuffer(buffer) ? buffer : null);
	}

	private cached(key: string, factory: () => Promise<Buffer | null>): Promise<Buffer | null> {
		const now = this.now();
		const found = this.cache.get(key);
		if (found && (!found.settled || found.expiresAt > now)) {
			this.cache.delete(key);
			this.cache.set(key, found);
			return found.value;
		}
		if (found) this.removeCacheEntry(key, found);
		const entry: CacheEntry = { expiresAt: Number.POSITIVE_INFINITY, value: Promise.resolve(null), bytes: 0, settled: false };
		entry.value = factory()
			.catch(() => null)
			.then((result) => {
				if (this.cache.get(key) !== entry) return result;
				entry.settled = true;
				entry.expiresAt = this.now() + (result ? this.successTtlMs : this.negativeTtlMs);
				entry.bytes = result?.length ?? 0;
				this.cacheBytes += entry.bytes;
				this.evict(key);
				return result;
			});
		this.cache.set(key, entry);
		this.evict(key);
		return entry.value;
	}

	private async resolvePublicHost(url: URL): Promise<Array<{ address: string; family: number }> | null> {
		const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
		if (isPrivateHostname(hostname)) return null;
		try {
			const addresses = await lookup(hostname, { all: true, verbatim: true });
			return addresses.length > 0 && addresses.every(({ address }) => isIP(address) !== 0 && !isPrivateAddress(address))
				? addresses
				: null;
		} catch {
			return null;
		}
	}

	private parseRemote(value: string, discordOnly: boolean): URL | null {
		try {
			const url = new URL(value);
			if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
			if (discordOnly && !isOfficialDiscordAssetUrl(url.toString())) return null;
			return url;
		} catch {
			return null;
		}
	}

	private async fetchRemote(value: string, discordOnly: boolean, redirects = 0): Promise<Buffer | null> {
		const url = this.parseRemote(value, discordOnly);
		if (!url) return null;
		const addresses = await this.resolvePublicHost(url);
		if (!addresses) return null;
		const dispatcher = new Agent({
			connect: {
				lookup: ((_hostname: string, options: { family?: number; all?: boolean }, callback: (...args: any[]) => void) => {
					const candidates = options.family
						? addresses.filter(({ family }) => family === options.family)
						: addresses;
					const selected = candidates[0] ?? addresses[0];
					if (options.all) callback(null, candidates.length ? candidates : addresses);
					else callback(null, selected?.address, selected?.family);
				}) as any,
			},
		});
		try {
			const response = await request(url, {
				method: "GET", dispatcher,
				headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS,
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: { accept: "image/png,image/jpeg,image/webp,image/gif", "user-agent": "Elfaria-Profile/1.0" },
			});
			if (response.statusCode >= 300 && response.statusCode < 400) {
				await response.body.dump();
				const locationHeader = response.headers.location;
				const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
				if (!location || redirects >= MAX_REDIRECTS) return null;
				return this.fetchRemote(new URL(location, url).toString(), discordOnly, redirects + 1);
			}
			if (response.statusCode !== 200) {
				await response.body.dump();
				return null;
			}
			const mime = String(response.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
			const declaredLength = Number(response.headers["content-length"] ?? 0);
			if (!mime || !IMAGE_MIMES.has(mime) || (declaredLength > 0 && declaredLength > MAX_BYTES)) {
				await response.body.dump();
				return null;
			}
			const chunks: Buffer[] = [];
			let total = 0;
			for await (const chunk of response.body) {
				const buffer = Buffer.from(chunk);
				total += buffer.length;
				if (total > MAX_BYTES) { response.body.destroy(); return null; }
				chunks.push(buffer);
			}
			const result = Buffer.concat(chunks, total);
			return isImageBuffer(result) ? result : null;
		} finally {
			await dispatcher.close();
		}
	}

	private async readLocal(value: string): Promise<Buffer | null> {
		try {
			const normalized = value.replaceAll("\\", "/").replace(/^images\//i, "");
			if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
			const [root, candidate] = await Promise.all([
				realpath(this.imagesRoot),
				realpath(path.resolve(this.imagesRoot, normalized)),
			]);
			const relative = path.relative(root, candidate);
			if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
			const info = await stat(candidate);
			if (!info.isFile() || info.size > MAX_BYTES) return null;
			const buffer = await readFile(candidate);
			return isImageBuffer(buffer) ? buffer : null;
		} catch {
			return null;
		}
	}
}

export const profileAssetLoader = new ProfileAssetLoader();