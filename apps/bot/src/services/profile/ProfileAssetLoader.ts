import { lookup } from "node:dns/promises";
import { readFile, realpath, stat } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import path from "node:path";
import type { BadgeAsset } from "@repo/db";
import { Agent, request } from "undici";
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
const EXTRA_RESTRICTED_ADDRESSES = new BlockList();
for (const [network, prefix] of [
	["::", 96], // IPv4-compatible and other low-address forms.
	["::ffff:0:0", 96], // IPv4-mapped addresses, including hexadecimal forms.
	["64:ff9b::", 96], // Well-known NAT64 translation prefix.
	["64:ff9b:1::", 48], // Local-use NAT64 translation prefix.
	["2001::", 32], // Teredo can encapsulate otherwise restricted IPv4 targets.
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:20::", 28],
	["2002::", 16], // 6to4 embeds an IPv4 destination.
] as const)
	EXTRA_RESTRICTED_ADDRESSES.addSubnet(network, prefix, "ipv6");

type ResolvedAddress = { address: string; family: number };
export interface ProfileAssetRemoteBody extends AsyncIterable<Uint8Array> {
	dump(): Promise<void>;
	destroy(error?: Error): void;
}
export interface ProfileAssetRemoteResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: ProfileAssetRemoteBody;
	close(): Promise<void>;
}
export type ProfileAssetRequest = (url: URL, addresses: readonly ResolvedAddress[], signal: AbortSignal) => Promise<ProfileAssetRemoteResponse>;

type CacheEntry = { expiresAt: number; value: Promise<Buffer | null>; bytes: number; settled: boolean };
export type ProfileAssetSource = string | Buffer | Uint8Array | null | undefined;

export interface ProfileAssetCacheOptions {
	maxBytes?: number;
	maxEntries?: number;
	successTtlMs?: number;
	negativeTtlMs?: number;
	now?: () => number;
	/** Testable DNS boundary; production uses the system resolver. */
	lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
	/** Testable HTTP boundary; production pins requests to the validated DNS result. */
	request?: ProfileAssetRequest;
	timeoutMs?: number;
}

/** Rejects non-IP and non-global address forms, including IPv4 embedded in IPv6. */
export function isPublicProfileAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0 || isPrivateAddress(address)) return false;
	return family !== 6 || !EXTRA_RESTRICTED_ADDRESSES.check(address, "ipv6");
}

function detectImageMime(buffer: Buffer): string | null {
	if (buffer.length < 12) return null;
	if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
	if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
	if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
	return null;
}

function isImageBuffer(buffer: Buffer): boolean {
	return detectImageMime(buffer) !== null;
}

export function isOfficialDiscordAssetUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !DISCORD_HOSTS.has(url.hostname.toLowerCase())) return false;
		const expectedPath = /^\/(?:avatars|banners)\/\d{17,20}\/[a-zA-Z0-9_]+\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) || /^\/embed\/avatars\/[0-5]\.png$/i.test(url.pathname);
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
	private readonly lookupHost: (hostname: string) => Promise<ResolvedAddress[]>;
	private readonly requestRemote: ProfileAssetRequest;
	private readonly timeoutMs: number;
	private cacheBytes = 0;

	public constructor(imagesRoot = path.resolve(__dirname, "..", "..", "..", "images"), options: ProfileAssetCacheOptions = {}) {
		this.imagesRoot = imagesRoot;
		this.maxCacheBytes = Math.max(1, Math.min(options.maxBytes ?? CACHE_MAX_BYTES, 64 * 1024 * 1024));
		this.maxCacheEntries = Math.max(1, Math.min(options.maxEntries ?? CACHE_LIMIT, 256));
		this.successTtlMs = options.successTtlMs ?? CACHE_TTL_MS;
		this.negativeTtlMs = options.negativeTtlMs ?? NEGATIVE_CACHE_TTL_MS;
		this.now = options.now ?? Date.now;
		this.lookupHost = options.lookup ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
		this.requestRemote = options.request ?? ((url, addresses, signal) => this.requestPinned(url, addresses, signal));
		this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MS));
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
		return asset.kind === "remote" ? this.cached(`remote:${asset.url}`, () => this.fetchRemote(asset.url, false)) : this.cached(`local:${asset.path}`, () => this.readLocal(asset.path));
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
		// Keep the configured entry cap hard even when every existing request is unresolved.
		while (this.cache.size >= this.maxCacheEntries) {
			const candidate = [...this.cache.entries()].find(([, entry]) => entry.settled);
			if (!candidate) return Promise.resolve(null);
			this.removeCacheEntry(candidate[0], candidate[1]);
		}
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

	private async withinDeadline<T>(value: Promise<T>, deadline: number): Promise<T> {
		const waitMs = deadline - Date.now();
		if (waitMs <= 0) throw new Error("Profile asset request timed out");
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				value,
				new Promise<T>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error("Profile asset request timed out")), waitMs);
					timer.unref();
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private async resolvePublicHost(url: URL, deadline: number): Promise<ResolvedAddress[] | null> {
		const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
		if (isPrivateHostname(hostname)) return null;
		try {
			const resolved = await this.withinDeadline(this.lookupHost(hostname), deadline);
			if (!resolved.length || resolved.length > 16) return null;
			const addresses = [...new Map(resolved.map((item) => [`${item.family}:${item.address}`, item])).values()];
			if (addresses.length > 8) return null;
			return addresses.every(({ address, family }) => family === isIP(address) && isPublicProfileAddress(address)) ? addresses : null;
		} catch {
			return null;
		}
	}

	private parseRemote(value: string, discordOnly: boolean): URL | null {
		if (!value || value.length > 2_048) return null;
		try {
			const url = new URL(value);
			if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
			if (discordOnly && !isOfficialDiscordAssetUrl(url.toString())) return null;
			return url;
		} catch {
			return null;
		}
	}

	private async requestPinned(url: URL, addresses: readonly ResolvedAddress[], signal: AbortSignal): Promise<ProfileAssetRemoteResponse> {
		const dispatcher = new Agent({
			connect: {
				lookup: ((_hostname: string, options: { family?: number; all?: boolean }, callback: (...args: any[]) => void) => {
					const candidates = options.family ? addresses.filter(({ family }) => family === options.family) : [...addresses];
					if (!candidates.length) {
						callback(new Error("No validated address for requested family"));
						return;
					}
					if (options.all) callback(null, candidates);
					else callback(null, candidates[0]!.address, candidates[0]!.family);
				}) as any,
			},
		});
		try {
			const response = await request(url, {
				method: "GET",
				dispatcher,
				headersTimeout: this.timeoutMs,
				bodyTimeout: this.timeoutMs,
				signal,
				headers: { accept: "image/png,image/jpeg,image/webp,image/gif", "user-agent": "Elfaria-Profile/1.0" },
			});
			return {
				statusCode: response.statusCode,
				headers: response.headers as Record<string, string | string[] | undefined>,
				body: response.body,
				close: () => dispatcher.destroy(),
			};
		} catch (error) {
			await dispatcher.destroy().catch(() => undefined);
			throw error;
		}
	}

	private async fetchRemote(value: string, discordOnly: boolean, redirects = 0, deadline = Date.now() + this.timeoutMs): Promise<Buffer | null> {
		const url = this.parseRemote(value, discordOnly);
		if (!url || deadline <= Date.now()) return null;
		const addresses = await this.resolvePublicHost(url, deadline);
		if (!addresses) return null;
		const controller = new AbortController();
		const waitMs = deadline - Date.now();
		if (waitMs <= 0) return null;
		const timer = setTimeout(() => controller.abort(), waitMs);
		timer.unref();
		let response: ProfileAssetRemoteResponse | null = null;
		try {
			response = await this.withinDeadline(this.requestRemote(url, addresses, controller.signal), deadline);
			if (response.statusCode >= 300 && response.statusCode < 400) {
				await this.withinDeadline(response.body.dump(), deadline);
				const location = response.headers.location;
				if (typeof location !== "string" || !location || redirects >= MAX_REDIRECTS) return null;
				return this.fetchRemote(new URL(location, url).toString(), discordOnly, redirects + 1, deadline);
			}
			if (response.statusCode !== 200) {
				await this.withinDeadline(response.body.dump(), deadline);
				return null;
			}
			const contentType = response.headers["content-type"];
			const mime = typeof contentType === "string" ? contentType.split(";", 1)[0]!.trim().toLowerCase() : "";
			const contentLength = response.headers["content-length"];
			const contentEncoding = response.headers["content-encoding"];
			const hasSafeEncoding = contentEncoding === undefined || (typeof contentEncoding === "string" && contentEncoding.trim().toLowerCase() === "identity");
			if (!mime || !IMAGE_MIMES.has(mime) || !hasSafeEncoding || (contentLength !== undefined && (typeof contentLength !== "string" || !/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES))) {
				await this.withinDeadline(response.body.dump(), deadline);
				return null;
			}
			const chunks: Buffer[] = [];
			let total = 0;
			const iterator = response.body[Symbol.asyncIterator]();
			while (true) {
				const next = await this.withinDeadline(iterator.next(), deadline);
				if (next.done) break;
				total += next.value.byteLength;
				if (total > MAX_BYTES) return null;
				chunks.push(Buffer.from(next.value));
			}
			const result = Buffer.concat(chunks, total);
			return detectImageMime(result) === mime ? result : null;
		} finally {
			clearTimeout(timer);
			controller.abort();
			if (response) {
				try {
					response.body.destroy();
				} catch {
					/* best-effort stream cleanup */
				}
				await Promise.resolve()
					.then(() => response!.close())
					.catch(() => undefined);
			}
		}
	}

	private async readLocal(value: string): Promise<Buffer | null> {
		try {
			const normalized = value.replaceAll("\\", "/").replace(/^images\//i, "");
			if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
			const [root, candidate] = await Promise.all([realpath(this.imagesRoot), realpath(path.resolve(this.imagesRoot, normalized))]);
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
