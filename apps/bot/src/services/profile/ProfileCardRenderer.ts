import { createHash } from "node:crypto";
import type { BadgeAsset, UserProfileData } from "@repo/db";
import type { User } from "discord.js";
import { getCanvas } from "../../utils/canvas";
import { composeAnimatedProfile, type AcquireAnimationLease } from "./ProfileAnimationCodec";
import { layoutOfficialBadges, officialBadgeVersion, type OfficialProfileBadge } from "./OfficialProfileBadges";
import { ProfileAssetLoader, profileAssetLoader, type ProfileAssetSource } from "./ProfileAssetLoader";
import type { ProfileBadgeEntry, ProfileBadgeView } from "./ProfileBadgeService";

const OUTPUT_LIMIT = Math.floor(7.5 * 1024 * 1024);
const CACHE_TTL_MS = 90_000;
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 128;
const IN_FLIGHT_LIMIT = 32;
const USER_GENERATION_LIMIT = 1_024;
const TRANSIENT_FALLBACK_TTL_MS = 7_500;
export const OUTPUT_POLICY_VERSION = "profile-card-v4-raw-rgba";
const FALLBACK_BIO = "No bio set — a quiet story waiting to be written.";

type BadgeEntries = { entries: ProfileBadgeEntry[]; overflow: number; version: string };
type RenderCacheEntry = { expiresAt: number; output: ProfileCardRenderOutput; bytes: number; userId: string };

export interface ProfileCardRenderOutput {
	buffer: Buffer;
	format: "png" | "gif";
	/** Internal cache hint used for transient safe-PNG fallbacks. */
	cacheTtlMs?: number;
}

export function profileFallbackCacheTtl(transient: boolean): number {
	return transient ? TRANSIENT_FALLBACK_TTL_MS : CACHE_TTL_MS;
}

export interface ProfileCardRenderInput {
	user: User;
	premium: boolean;
	profile?: UserProfileData | null;
	badges?: ProfileBadgeView | ProfileBadgeEntry[] | null;
	officialBadges?: OfficialProfileBadge[];
	serverBooster?: boolean;
	avatar?: ProfileAssetSource;
	banner?: ProfileAssetSource;
	avatarHash?: string | null;
	bannerHash?: string | null;
	avatarAnimated?: boolean;
	bannerAnimated?: boolean;
	profileVersion?: string | number | Date | null;
	badgeVersion?: string | number | null;
	/** Optional deployment-wide slot acquisition. Deliberately excluded from cache identity. */
	acquireAnimationLease?: AcquireAnimationLease;
}
export function sanitizeProfileText(value: unknown, maxLength = 80): string {
	const clean = String(value ?? "")
		.normalize("NFKC")
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.replace(/@/g, "＠")
		.replace(/[*_~`>|#[\]\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const units = Array.from(clean);
	return units.length <= maxLength ? clean : `${units.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

export function resolveProfileBio(profile: UserProfileData | null | undefined): string {
	return sanitizeProfileText(profile?.bio, 190) || FALLBACK_BIO;
}

export function profileBioDigest(profile: UserProfileData | null | undefined): string {
	return createHash("sha256").update(resolveProfileBio(profile), "utf8").digest("hex").slice(0, 20);
}

function asTimestamp(value: string | number | Date | null | undefined): string {
	return value instanceof Date ? String(value.getTime()) : String(value ?? "0");
}

function roundRect(ctx: any, x: number, y: number, width: number, height: number, radius: number): void {
	ctx.beginPath();
	ctx.roundRect(x, y, width, height, radius);
}

function cover(ctx: any, image: any, x: number, y: number, width: number, height: number): void {
	const scale = Math.max(width / image.width, height / image.height);
	const sourceWidth = width / scale;
	const sourceHeight = height / scale;
	ctx.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2,
		sourceWidth, sourceHeight, x, y, width, height);
}

function assetFor(entry: ProfileBadgeEntry): BadgeAsset {
	return entry.definition.imageUrl
		? { kind: "remote", url: entry.definition.imageUrl }
		: { kind: "local", path: entry.definition.assetPath ?? "" };
}
function badgeEntries(value: ProfileCardRenderInput["badges"]): BadgeEntries {
	if (!value) return { entries: [], overflow: 0, version: "0" };
	if (Array.isArray(value)) {
		const ordered = [...value].sort((a, b) =>
			b.definition.sortPriority - a.definition.sortPriority || a.definition.key.localeCompare(b.definition.key));
		return {
			entries: ordered.slice(0, 5),
			overflow: Math.max(0, ordered.length - 5),
			version: ordered.map(({ definition, assignment }) => `${definition.key}:${definition.version}:${assignment?.version ?? 0}`).join(","),
		};
	}
	return { entries: value.visible, overflow: value.overflow, version: value.versionToken };
}

function discordAvatar(input: ProfileCardRenderInput): ProfileAssetSource {
	return input.avatar || input.user.displayAvatarURL({ extension: "png", size: 1024 });
}

function discordBanner(input: ProfileCardRenderInput): ProfileAssetSource {
	return input.banner || input.user.bannerURL({ extension: "png", size: 1024 }) || null;
}

function sourceVersion(source: ProfileAssetSource): string {
	if (typeof source === "string") return source;
	if (source instanceof Uint8Array) return createHash("sha256").update(source).digest("hex").slice(0, 16);
	return "none";
}

export function buildProfileRenderCacheKey(input: ProfileCardRenderInput, generation: string | number = 0): string {
	const badges = input.premium ? badgeEntries(input.badges) : { entries: [], overflow: 0, version: "hidden" };
	const avatar = discordAvatar(input);
	const banner = discordBanner(input);
	return [
		OUTPUT_POLICY_VERSION, input.user.id, generation,
		input.avatarHash ?? input.user.avatar ?? sourceVersion(avatar),
		input.bannerHash ?? input.user.banner ?? sourceVersion(banner),
		input.avatarAnimated ? "avatar-gif" : "avatar-static",
		input.bannerAnimated ? "banner-gif" : "banner-static",
		input.premium ? 1 : 0,
		asTimestamp(input.profileVersion ?? input.profile?.updatedAt ?? 0),
		profileBioDigest(input.profile),
		String(input.badgeVersion ?? badges.version),
		officialBadgeVersion(input.officialBadges ?? []),
		input.serverBooster ? 1 : 0,
	].join("|");
}

export function profileAttachmentName(userId: string, format: ProfileCardRenderOutput["format"]): string {
	return `elfaria-profile-${userId}.${format}`;
}

export function preferredProfileFormat(avatarAnimated: boolean, bannerAnimated: boolean): ProfileCardRenderOutput["format"] {
	return avatarAnimated || bannerAnimated ? "gif" : "png";
}

export class ProfileCardRenderer {
	private readonly cache = new Map<string, RenderCacheEntry>();
	private readonly inFlight = new Map<string, Promise<ProfileCardRenderOutput | null>>();
	private readonly userGeneration = new Map<string, number>();
	private cacheBytes = 0;
	private cacheEpoch = 0;

	public constructor(private readonly assets: ProfileAssetLoader = profileAssetLoader) {}

	public static render(input: ProfileCardRenderInput): Promise<ProfileCardRenderOutput | null> {
		return profileCardRenderer.render(input);
	}

	public cacheKeyFor(input: ProfileCardRenderInput): string {
		return buildProfileRenderCacheKey(input, this.userGeneration.get(input.user.id) ?? 0);
	}

	public render(input: ProfileCardRenderInput): Promise<ProfileCardRenderOutput | null> {
		const generation = this.userGeneration.get(input.user.id) ?? 0;
		const key = buildProfileRenderCacheKey(input, generation);
		const now = Date.now();
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > now) {
			this.cache.delete(key);
			this.cache.set(key, cached);
			return Promise.resolve(cached.output);
		}
		if (cached) this.removeCacheEntry(key, cached);
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const badges = input.premium ? badgeEntries(input.badges) : { entries: [], overflow: 0, version: "hidden" };
		const value = this.renderUncached(input, badges)
			.then((output) => {
				if (output && (this.userGeneration.get(input.user.id) ?? 0) === generation) this.store(key, input.user.id, output);
				return output;
			})
			.catch(() => null)
			.finally(() => { this.inFlight.delete(key); });
		this.inFlight.set(key, value);
		return value;
	}

	public invalidateUser(userId: string): number {
		this.userGeneration.set(userId, (this.userGeneration.get(userId) ?? 0) + 1);
		let removed = 0;
		for (const [key, entry] of this.cache) {
			if (entry.userId !== userId) continue;
			this.removeCacheEntry(key, entry);
			removed += 1;
		}
		return removed;
	}

	public clearCache(): void {
		this.cache.clear();
		this.cacheBytes = 0;
		this.userGeneration.clear();
	}

	private removeCacheEntry(key: string, entry: RenderCacheEntry): void {
		this.cache.delete(key);
		this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
	}

	private store(key: string, userId: string, output: ProfileCardRenderOutput): void {
		if (output.buffer.length > CACHE_MAX_BYTES) return;
		while ((this.cacheBytes + output.buffer.length > CACHE_MAX_BYTES || this.cache.size >= CACHE_MAX_ENTRIES) && this.cache.size) {
			const oldestKey = this.cache.keys().next().value as string;
			const oldest = this.cache.get(oldestKey);
			if (oldest) this.removeCacheEntry(oldestKey, oldest);
		}
		this.cache.set(key, {
			expiresAt: Date.now() + (output.cacheTtlMs ?? CACHE_TTL_MS),
			output,
			bytes: output.buffer.length,
			userId,
		});
		this.cacheBytes += output.buffer.length;
	}
	private async renderUncached(input: ProfileCardRenderInput, badges: BadgeEntries): Promise<ProfileCardRenderOutput | null> {
		const canvasApi = getCanvas();
		if (!canvasApi) return null;
		const [avatarBuffer, bannerBuffer, badgeBuffers] = await Promise.all([
			this.assets.loadDiscord(discordAvatar(input)),
			this.assets.loadDiscord(discordBanner(input)),
			input.premium
				? Promise.all(badges.entries.map((entry) => this.assets.loadBadge(assetFor(entry))))
				: Promise.resolve([]),
		]);
		const load = async (buffer: Buffer | null): Promise<any | null> => {
			if (!buffer) return null;
			try { return await canvasApi.loadImage(buffer); } catch { return null; }
		};
		// Static counterparts and badges are decoded once and reused for every animation tick.
		const [staticAvatar, staticBanner, badgeImages] = await Promise.all([
			load(avatarBuffer), load(bannerBuffer), Promise.all(badgeBuffers.map(load)),
		]);
		const animated = await composeAnimatedProfile({
			avatar: avatarBuffer,
			banner: bannerBuffer,
			avatarAnimated: Boolean(input.avatarAnimated),
			bannerAnimated: Boolean(input.bannerAnimated),
		}, async (avatarFrame, bannerFrame, width, height) => {
			const [avatar, banner] = await Promise.all([
				input.avatarAnimated ? load(avatarFrame) : Promise.resolve(staticAvatar),
				input.bannerAnimated ? load(bannerFrame) : Promise.resolve(staticBanner),
			]);
			return this.paint(canvasApi, input, badges, avatar, banner, badgeImages, width, height, true);
		}, OUTPUT_LIMIT, input.acquireAnimationLease);
		if (animated.ok) return { buffer: animated.buffer, format: "gif" };

		for (const [width, height] of [[1200, 675], [960, 540]] as const) {
			try {
				const output = await this.paint(canvasApi, input, badges, staticAvatar, staticBanner, badgeImages, width, height, false);
				if (output.length <= OUTPUT_LIMIT) {
					return { buffer: output, format: "png", cacheTtlMs: profileFallbackCacheTtl(animated.transient) };
				}
			} catch {
				// Retry the lower-memory canvas before declaring the renderer unavailable.
			}
		}
		return null;
	}

	private async paint(
		canvasApi: typeof import("@napi-rs/canvas"), input: ProfileCardRenderInput,
		badges: BadgeEntries, avatar: any, banner: any, badgeImages: any[],
		width: number, height: number, rawRgba: boolean,
	): Promise<Buffer> {
		const canvas = canvasApi.createCanvas(width, height);
		const ctx: any = canvas.getContext("2d");
		ctx.scale(width / 1200, height / 675);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.textRendering = "geometricPrecision";
		this.drawBackground(ctx, banner);
		this.drawAvatar(ctx, avatar, input.user);
		this.drawIdentity(ctx, input);
		this.drawDetails(ctx, input, badges, badgeImages);
		if (!rawRgba) return canvas.encode("png");
		ctx.resetTransform();
		const rgba = ctx.getImageData(0, 0, width, height).data;
		return Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
	}
	private drawBackground(ctx: any, banner: any): void {
		const base = ctx.createLinearGradient(0, 0, 1200, 675);
		base.addColorStop(0, "#15152b"); base.addColorStop(0.5, "#25204a"); base.addColorStop(1, "#111827");
		ctx.fillStyle = base; ctx.fillRect(0, 0, 1200, 675);
		ctx.save(); roundRect(ctx, 24, 24, 1152, 300, 34); ctx.clip();
		if (banner) cover(ctx, banner, 24, 24, 1152, 300);
		else {
			const fallback = ctx.createLinearGradient(24, 24, 1176, 324);
			fallback.addColorStop(0, "#7c3aed"); fallback.addColorStop(0.48, "#ec4899"); fallback.addColorStop(1, "#22d3ee");
			ctx.fillStyle = fallback; ctx.fillRect(24, 24, 1152, 300);
		}
		const shade = ctx.createLinearGradient(0, 30, 0, 324);
		shade.addColorStop(0, "rgba(10,8,28,.08)"); shade.addColorStop(1, "rgba(9,10,27,.82)");
		ctx.fillStyle = shade; ctx.fillRect(24, 24, 1152, 300);
		ctx.fillStyle = "rgba(255,255,255,.10)";
		ctx.beginPath(); ctx.moveTo(760, 24); ctx.lineTo(930, 24); ctx.lineTo(720, 324); ctx.lineTo(550, 324); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,.07)";
		ctx.beginPath(); ctx.moveTo(970, 24); ctx.lineTo(1160, 24); ctx.lineTo(950, 324); ctx.lineTo(760, 324); ctx.fill();
		ctx.restore();
		ctx.fillStyle = "rgba(16,18,38,.92)"; roundRect(ctx, 24, 286, 1152, 365, 34); ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 2; ctx.stroke();
	}

	private drawAvatar(ctx: any, avatar: any, user: User): void {
		ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 28; ctx.fillStyle = "#f5d0fe";
		ctx.beginPath(); ctx.arc(190, 292, 116, 0, Math.PI * 2); ctx.fill();
		ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(190, 292, 106, 0, Math.PI * 2); ctx.clip();
		if (avatar) cover(ctx, avatar, 84, 186, 212, 212);
		else {
			const fallback = ctx.createLinearGradient(84, 186, 296, 398);
			fallback.addColorStop(0, "#a855f7"); fallback.addColorStop(1, "#06b6d4");
			ctx.fillStyle = fallback; ctx.fillRect(84, 186, 212, 212);
			ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "96px Poppins-Bold";
			ctx.fillText(sanitizeProfileText(user.globalName ?? user.username, 1).toUpperCase() || "?", 190, 298);
		}
		ctx.restore();
	}
	private fitText(ctx: any, value: string, maxWidth: number): string {
		if (ctx.measureText(value).width <= maxWidth) return value;
		const units = Array.from(value);
		while (units.length && ctx.measureText(`${units.join("")}…`).width > maxWidth) units.pop();
		return `${units.join("")}…`;
	}

	private drawIdentity(ctx: any, input: ProfileCardRenderInput): void {
		const { user } = input;
		const official = input.officialBadges ?? [];
		const rightEdge = input.premium ? 928 : 1130;
		ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#ffffff"; ctx.font = "44px Poppins-Bold";
		const rawName = sanitizeProfileText(user.globalName ?? user.username, 40) || "Unknown user";
		const nameWidth = Math.max(180, rightEdge - 330 - (official.length ? 118 : 0));
		const displayName = this.fitText(ctx, rawName, nameWidth);
		ctx.fillText(displayName, 330, 337);
		const badgeX = 330 + ctx.measureText(displayName).width + 10;
		this.drawOfficialBadges(ctx, official, badgeX, 309, Math.max(0, rightEdge - badgeX));
		ctx.fillStyle = "#c7c5e5"; ctx.font = "22px Poppins-Regular";
		ctx.fillText(`@${sanitizeProfileText(user.username, 32)}`, 332, 374, 500);
		if (input.premium) {
			const gradient = ctx.createLinearGradient(925, 302, 1128, 346);
			gradient.addColorStop(0, "#f0abfc"); gradient.addColorStop(1, "#67e8f9");
			ctx.fillStyle = gradient; roundRect(ctx, 942, 302, 184, 44, 22); ctx.fill();
			ctx.fillStyle = "#20143c"; ctx.font = "17px Poppins-Bold"; ctx.textAlign = "center";
			ctx.fillText("✦ PREMIUM", 1034, 331);
		}
	}

	private drawOfficialBadges(ctx: any, badges: readonly OfficialProfileBadge[], x: number, y: number, width: number): void {
		const layout = layoutOfficialBadges(badges, width);
		for (let index = 0; index < layout.visible.length; index += 1) {
			const badge = layout.visible[index]!;
			const left = x + index * 33;
			ctx.fillStyle = badge.color; ctx.beginPath(); ctx.arc(left + 14, y + 14, 14, 0, Math.PI * 2); ctx.fill();
			ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1; ctx.stroke();
			ctx.fillStyle = "#ffffff"; ctx.font = badge.mark.length > 1 ? "9px Poppins-Bold" : "13px Poppins-Bold";
			ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(badge.mark, left + 14, y + 15);
		}
		if (layout.overflow > 0) {
			const left = x + layout.visible.length * 33;
			ctx.fillStyle = "rgba(255,255,255,.15)"; roundRect(ctx, left, y, 38, 28, 14); ctx.fill();
			ctx.fillStyle = "#ffffff"; ctx.font = "11px Poppins-Bold"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
			ctx.fillText(`+${layout.overflow}`, left + 19, y + 15);
		}
		ctx.textBaseline = "alphabetic";
	}
	private chip(ctx: any, label: string, value: string, x: number, y: number, width: number): void {
		ctx.fillStyle = "rgba(255,255,255,.055)"; roundRect(ctx, x, y, width, 62, 16); ctx.fill();
		ctx.fillStyle = "#8f8cad"; ctx.font = "13px Poppins-Bold"; ctx.textAlign = "left";
		ctx.fillText(label.toUpperCase(), x + 18, y + 23);
		ctx.fillStyle = "#f7f5ff"; ctx.font = "17px Poppins-Regular";
		ctx.fillText(sanitizeProfileText(value, 30), x + 18, y + 48, width - 32);
	}

	private drawDetails(ctx: any, input: ProfileCardRenderInput, badges: BadgeEntries, badgeImages: any[]): void {
		const created = new Date(input.user.createdTimestamp).toLocaleDateString("en-US", {
			year: "numeric", month: "short", day: "2-digit", timeZone: "UTC",
		});
		this.chip(ctx, "User ID", input.user.id, 70, 420, 330);
		this.chip(ctx, "Created", created, 415, 420, 300);
		this.chip(ctx, "Account", input.user.bot ? "Bot account" : "Human account", 730, 420, 400);
		ctx.fillStyle = "#a6a2c6"; ctx.font = "14px Poppins-Bold"; ctx.textAlign = "left";
		ctx.fillText("BIO", 70, 520);
		ctx.fillStyle = "#f2efff"; ctx.font = "18px Poppins-Regular";
		this.wrappedText(ctx, resolveProfileBio(input.profile), 70, 550, input.premium ? 590 : 1030, 27, 2);
		if (input.premium) this.drawBadges(ctx, badges, badgeImages);
		ctx.fillStyle = "#777493"; ctx.font = "14px Poppins-Regular"; ctx.textAlign = "right";
		ctx.fillText("Powered by Elfaria  ✦", 1130, 624);
	}

	private wrappedText(ctx: any, text: string, x: number, y: number, width: number, lineHeight: number, lines: number): void {
		const words = text.split(" ");
		let line = "";
		let row = 0;
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
			if (line) ctx.fillText(row === lines - 1 ? sanitizeProfileText(`${line}…`, 100) : line, x, y + row * lineHeight, width);
			row += 1;
			if (row >= lines) return;
			line = word;
		}
		if (line && row < lines) ctx.fillText(line, x, y + row * lineHeight, width);
	}
	private drawBadges(ctx: any, badges: BadgeEntries, images: any[]): void {
		ctx.fillStyle = "#a6a2c6"; ctx.font = "14px Poppins-Bold"; ctx.textAlign = "left"; ctx.fillText("BADGES", 720, 520);
		if (!badges.entries.length) {
			ctx.fillStyle = "#777493"; ctx.font = "16px Poppins-Regular"; ctx.fillText("No badges assigned", 720, 558);
			return;
		}
		for (let index = 0; index < Math.min(5, badges.entries.length); index += 1) {
			const x = 720 + index * 72;
			ctx.save(); ctx.fillStyle = "rgba(255,255,255,.08)";
			ctx.beginPath(); ctx.arc(x + 27, 560, 27, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(x + 27, 560, 21, 0, Math.PI * 2); ctx.clip();
			if (images[index]) cover(ctx, images[index], x + 6, 539, 42, 42);
			else {
				const color = ctx.createLinearGradient(x, 539, x + 48, 581);
				color.addColorStop(0, "#d946ef"); color.addColorStop(1, "#22d3ee");
				ctx.fillStyle = color; ctx.fillRect(x + 6, 539, 42, 42);
				ctx.fillStyle = "white"; ctx.font = "16px Poppins-Bold"; ctx.textAlign = "center";
				ctx.fillText(sanitizeProfileText(badges.entries[index]?.definition.displayName, 1).toUpperCase(), x + 27, 567);
			}
			ctx.restore();
		}
		if (badges.overflow > 0) {
			ctx.fillStyle = "rgba(236,72,153,.24)"; roundRect(ctx, 1080, 538, 54, 44, 16); ctx.fill();
			ctx.fillStyle = "#f5d0fe"; ctx.font = "17px Poppins-Bold"; ctx.textAlign = "center";
			ctx.fillText(`+${badges.overflow}`, 1107, 567);
		}
	}
}

export const profileCardRenderer = new ProfileCardRenderer();
export const renderProfileCard = (input: ProfileCardRenderInput): Promise<ProfileCardRenderOutput | null> => profileCardRenderer.render(input);
