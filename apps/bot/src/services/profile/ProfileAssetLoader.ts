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
const CACHE_LIMIT = 128;
const DISCORD_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type CacheEntry = { expiresAt: number; value: Promise<Buffer | null> };
export type ProfileAssetSource = string | Buffer | Uint8Array | null | undefined;

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
		return url.protocol === "https:" && !url.username && !url.password && !url.port
			&& DISCORD_HOSTS.has(url.hostname.toLowerCase());
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

	public constructor(imagesRoot = path.resolve(__dirname, "..", "..", "..", "images")) {
		this.imagesRoot = imagesRoot;
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
	}

	private fromBuffer(value: Uint8Array): Promise<Buffer | null> {
		const buffer = Buffer.from(value);
		return Promise.resolve(buffer.length <= MAX_BYTES && isImageBuffer(buffer) ? buffer : null);
	}

	private cached(key: string, factory: () => Promise<Buffer | null>): Promise<Buffer | null> {
		const now = Date.now();
		const found = this.cache.get(key);
		if (found && found.expiresAt > now) return found.value;
		if (found) this.cache.delete(key);
		while (this.cache.size >= CACHE_LIMIT) {
			const oldest = this.cache.keys().next().value as string | undefined;
			if (!oldest) break;
			this.cache.delete(oldest);
		}
		const value = factory().catch(() => null);
		this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
		return value;
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
			if (discordOnly && !DISCORD_HOSTS.has(url.hostname.toLowerCase())) return null;
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
				method: "GET", dispatcher, maxRedirections: 0,
				headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS,
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: { accept: "image/png,image/jpeg,image/webp,image/gif", "user-agent": "Elfaria-Profile/1.0" },
			});
			if (response.statusCode >= 300 && response.statusCode < 400) {
				await response.body.dump();
				const location = response.headers.location;
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