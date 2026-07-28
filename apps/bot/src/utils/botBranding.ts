import { lookup } from "node:dns/promises";
import { type Client, Routes } from "discord.js";
import { request } from "undici";
import { isPrivateAddress, isPrivateHostname, validateImageUrl } from "./botSettingsValidation";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
let brandingQueue: Promise<void> = Promise.resolve();

export class BrandingRateLimitError extends Error {
	public constructor(public readonly retryAfterSeconds: number) {
		super(`Discord is rate limiting identity changes for ${retryAfterSeconds} seconds`);
		this.name = "BrandingRateLimitError";
	}
}

/**
 * Discord only lets a bot customise its avatar and nickname per server (the
 * "server profile" rolled out in September 2025). Per-server banners and bios
 * are not yet supported for bot accounts, so those edits are rejected by the
 * API. This error lets callers surface an accurate, non-destructive message
 * instead of silently mutating the bot's global identity.
 */
export class UnsupportedGuildBrandingError extends Error {
	public constructor(public readonly field: "banner" | "bio") {
		super(`Discord does not support per-server bot ${field} customization`);
		this.name = "UnsupportedGuildBrandingError";
	}
}

export interface BrandingImage {
	data: Buffer;
	contentType: string;
}

/** The bot's currently applied identity within a single guild. */
export interface GuildBranding {
	avatarUrl: string | null;
	nickname: string | null;
	globalAvatarUrl: string;
}

export function readGuildBranding(client: Client, guildId: string): GuildBranding {
	const guild = client.guilds.cache.get(guildId);
	const me = guild?.members.me ?? null;
	return {
		avatarUrl: me?.avatarURL({ extension: "png", size: 1024 }) ?? null,
		nickname: me?.nickname ?? null,
		globalAvatarUrl: requireClientUser(client).displayAvatarURL({ extension: "png", size: 1024 }),
	};
}

export async function fetchBrandingImage(rawUrl: string): Promise<BrandingImage> {
	let current = validateImageUrl(rawUrl);
	if (!current) throw new Error("The image URL is not a supported public HTTPS URL");

	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		await assertPublicHost(new URL(current).hostname);
		const response = await request(current, {
			method: "GET",
			headersTimeout: 10_000,
			bodyTimeout: 15_000,
			headers: { "user-agent": "Elfaria-Bot-Settings/1.0", accept: "image/png,image/jpeg,image/webp,image/gif" },
		});
		if (response.statusCode >= 300 && response.statusCode < 400) {
			const rawLocation = response.headers.location;
			const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
			await response.body.dump();
			if (!location || redirect === MAX_REDIRECTS) throw new Error("The image URL redirected too many times");
			current = validateImageUrl(new URL(location, current).toString());
			if (!current) throw new Error("The image redirected to an unsupported address");
			continue;
		}
		if (response.statusCode !== 200) {
			await response.body.dump();
			throw new Error(`The image server returned HTTP ${response.statusCode}`);
		}
		const contentType = String(response.headers["content-type"] ?? "")
			.split(";", 1)[0]!
			.toLowerCase();
		const contentLength = Number(response.headers["content-length"] ?? 0);
		if (!ALLOWED_IMAGE_TYPES.has(contentType) || contentLength > MAX_IMAGE_BYTES) {
			await response.body.dump();
			throw new Error("The image must be PNG, JPEG, WebP, or GIF and no larger than 8 MB");
		}
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of response.body) {
			const buffer = Buffer.from(chunk);
			size += buffer.length;
			if (size > MAX_IMAGE_BYTES) throw new Error("The image is larger than 8 MB");
			chunks.push(buffer);
		}
		return { data: Buffer.concat(chunks), contentType };
	}
	throw new Error("The image could not be downloaded");
}

function toDataUri(image: BrandingImage): string {
	return `data:${image.contentType};base64,${image.data.toString("base64")}`;
}

/**
 * Applies a server-scoped avatar to the bot in a single guild via
 * `PATCH /guilds/{guild.id}/members/@me`. This never affects the bot's global
 * identity or any other server.
 */
export function updateGuildAvatar(client: Client, guildId: string, image: BrandingImage): Promise<void> {
	return editGuildProfile(client, guildId, { avatar: toDataUri(image) });
}

export function updateGuildBanner(client: Client, guildId: string, image: BrandingImage): Promise<void> {
	return editGuildProfile(client, guildId, { banner: toDataUri(image) }, "banner");
}

export function updateGuildBio(client: Client, guildId: string, bio: string): Promise<void> {
	return editGuildProfile(client, guildId, { bio }, "bio");
}

/** Clears every server-scoped override so the bot reverts to its global identity in this guild. */
export function resetGuildBranding(client: Client, guildId: string): Promise<void> {
	return editGuildProfile(client, guildId, { avatar: null, banner: null, nick: null });
}

function editGuildProfile(client: Client, guildId: string, body: Record<string, unknown>, unsupported?: "banner" | "bio"): Promise<void> {
	return serializeBrandingChange(async () => {
		try {
			await client.rest.patch(Routes.guildMember(guildId, "@me"), { body });
		} catch (error) {
			if (unsupported && isUnsupportedFieldError(error)) throw new UnsupportedGuildBrandingError(unsupported);
			throw error;
		}
	});
}

/** The bot's global account identity (shared across every server). */
export interface GlobalBranding {
	avatarUrl: string | null;
	bio: string | null;
	bannerUrl: string | null;
}

export async function readGlobalBranding(client: Client): Promise<GlobalBranding> {
	const user = requireClientUser(client);
	const application = requireApplication(client);
	await Promise.all([user.fetch(true), application.fetch()]);
	return {
		avatarUrl: user.avatarURL({ extension: "png", size: 1024 }),
		bio: application.description || null,
		bannerUrl: user.bannerURL({ extension: "png", size: 1024 }) ?? null,
	};
}

/** Sets the bot's global account avatar (applies everywhere the bot is). Developer-only surface. */
export function updateGlobalAvatar(client: Client, image: BrandingImage): Promise<void> {
	return serializeBrandingChange(async () => {
		await requireClientUser(client).setAvatar(image.data);
	});
}

export function updateGlobalBanner(client: Client, image: BrandingImage): Promise<void> {
	return serializeBrandingChange(async () => {
		await requireClientUser(client).setBanner(image.data);
	});
}

export function updateGlobalBio(client: Client, bio: string): Promise<void> {
	return serializeBrandingChange(async () => {
		await requireApplication(client).edit({ description: bio });
	});
}

function requireClientUser(client: Client): NonNullable<Client["user"]> {
	if (!client.user) throw new Error("The Discord client is not ready");
	return client.user;
}

function requireApplication(client: Client): NonNullable<Client["application"]> {
	if (!client.application) throw new Error("The Discord application is not ready");
	return client.application;
}

async function assertPublicHost(hostname: string): Promise<void> {
	const normalized = hostname.replace(/^\[|\]$/g, "");
	if (isPrivateHostname(normalized)) throw new Error("Private image hosts are not allowed");
	const addresses = await lookup(normalized, { all: true, verbatim: true });
	if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
		throw new Error("The image host resolves to a private network address");
	}
}

function serializeBrandingChange(operation: () => Promise<void>): Promise<void> {
	const result = brandingQueue.then(operation, operation).catch((error) => {
		throw normalizeBrandingError(error);
	});
	brandingQueue = result.catch(() => undefined);
	return result;
}

function normalizeBrandingError(error: unknown): unknown {
	if (error instanceof UnsupportedGuildBrandingError) return error;
	const candidate = error as { status?: number; code?: number | string; retryAfter?: number; rawError?: { retry_after?: number } };
	if (candidate?.status === 429 || candidate?.code === 20028 || candidate?.code === 20029) {
		const retryMs = candidate.retryAfter ?? (candidate.rawError?.retry_after ?? 60) * 1_000;
		return new BrandingRateLimitError(Math.max(1, Math.ceil(retryMs / 1_000)));
	}
	return error;
}

function isUnsupportedFieldError(error: unknown): boolean {
	const candidate = error as { status?: number; code?: number | string };
	// 50035 = invalid form body (unknown/unsupported field), 400 = bad request.
	return candidate?.code === 50035 || candidate?.status === 400;
}
