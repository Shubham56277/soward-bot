import type { BadgeAsset, UserProfileData } from "@repo/db";
import type { User } from "discord.js";
import { getCanvas } from "../../utils/canvas";
import { ProfileAssetLoader, profileAssetLoader, type ProfileAssetSource } from "./ProfileAssetLoader";
import type { ProfileBadgeEntry, ProfileBadgeView } from "./ProfileBadgeService";

const OUTPUT_LIMIT = Math.floor(7.5 * 1024 * 1024);
const CACHE_TTL_MS = 90_000;
const CACHE_LIMIT = 64;

type RenderCacheEntry = { expiresAt: number; value: Promise<Buffer | null> };

export interface ProfileCardRenderInput {
	user: User;
	premium: boolean;
	profile?: UserProfileData | null;
	badges?: ProfileBadgeView | ProfileBadgeEntry[] | null;
	avatar?: ProfileAssetSource;
	banner?: ProfileAssetSource;
	avatarHash?: string | null;
	bannerHash?: string | null;
	profileVersion?: string | number | Date | null;
	badgeVersion?: string | number | null;
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

function badgeEntries(value: ProfileCardRenderInput["badges"]): { entries: ProfileBadgeEntry[]; overflow: number; version: string } {
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
	if (input.avatar) return input.avatar;
	return input.user.displayAvatarURL({ extension: "png", size: 1024 });
}

function discordBanner(input: ProfileCardRenderInput): ProfileAssetSource {
	if (input.banner) return input.banner;
	return input.user.bannerURL({ extension: "png", size: 1024 }) ?? null;
}

export class ProfileCardRenderer {
	private readonly cache = new Map<string, RenderCacheEntry>();

	public constructor(private readonly assets: ProfileAssetLoader = profileAssetLoader) {}

	public static render(input: ProfileCardRenderInput): Promise<Buffer | null> {
		return profileCardRenderer.render(input);
	}

	public render(input: ProfileCardRenderInput): Promise<Buffer | null> {
		const badges = input.premium ? badgeEntries(input.badges) : { entries: [], overflow: 0, version: "hidden" };
		const avatar = discordAvatar(input);
		const banner = discordBanner(input);
		const profileVersion = input.profileVersion ?? input.profile?.updatedAt ?? 0;
		const key = [
			input.user.id,
			input.avatarHash ?? input.user.avatar ?? (typeof avatar === "string" ? avatar : "buffer"),
			input.bannerHash ?? input.user.banner ?? (typeof banner === "string" ? banner : "buffer"),
			input.premium ? 1 : 0,
			asTimestamp(profileVersion),
			String(input.badgeVersion ?? badges.version),
		].join("|");
		const now = Date.now();
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > now) return cached.value;
		if (cached) this.cache.delete(key);
		while (this.cache.size >= CACHE_LIMIT) {
			const oldest = this.cache.keys().next().value as string | undefined;
			if (!oldest) break;
			this.cache.delete(oldest);
		}
		const value = this.renderUncached(input, badges);
		this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
		return value;
	}

	public clearCache(): void {
		this.cache.clear();
	}

	private async renderUncached(
		input: ProfileCardRenderInput,
		badges: ReturnType<typeof badgeEntries>,
	): Promise<Buffer | null> {
		const canvasApi = getCanvas();
		if (!canvasApi) return null;
		const avatarSource = discordAvatar(input);
		const bannerSource = discordBanner(input);
		const [avatarBuffer, bannerBuffer, badgeBuffers] = await Promise.all([
			this.assets.loadDiscord(avatarSource),
			this.assets.loadDiscord(bannerSource),
			input.premium
				? Promise.all(badges.entries.map((entry) => this.assets.loadBadge(assetFor(entry))))
				: Promise.resolve([]),
		]);
		const load = async (buffer: Buffer | null): Promise<any | null> => {
			if (!buffer) return null;
			try { return await canvasApi.loadImage(buffer); } catch { return null; }
		};
		const [avatar, banner, badgeImages] = await Promise.all([
			load(avatarBuffer),
			load(bannerBuffer),
			Promise.all(badgeBuffers.map(load)),
		]);
		let output = await this.paint(canvasApi, input, badges, avatar, banner, badgeImages, 1200, 675);
		if (output.length > OUTPUT_LIMIT) {
			output = await this.paint(canvasApi, input, badges, avatar, banner, badgeImages, 960, 540);
		}
		return output.length <= OUTPUT_LIMIT ? output : null;
	}

	private async paint(
		canvasApi: typeof import("@napi-rs/canvas"), input: ProfileCardRenderInput,
		badges: ReturnType<typeof badgeEntries>, avatar: any, banner: any, badgeImages: any[],
		width: number, height: number,
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
		return canvas.encode("png");
	}

	private drawBackground(ctx: any, banner: any): void {
		const base = ctx.createLinearGradient(0, 0, 1200, 675);
		base.addColorStop(0, "#15152b");
		base.addColorStop(0.5, "#25204a");
		base.addColorStop(1, "#111827");
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, 1200, 675);
		ctx.save();
		roundRect(ctx, 24, 24, 1152, 300, 34);
		ctx.clip();
		if (banner) cover(ctx, banner, 24, 24, 1152, 300);
		else {
			const fallback = ctx.createLinearGradient(24, 24, 1176, 324);
			fallback.addColorStop(0, "#7c3aed");
			fallback.addColorStop(0.48, "#ec4899");
			fallback.addColorStop(1, "#22d3ee");
			ctx.fillStyle = fallback;
			ctx.fillRect(24, 24, 1152, 300);
		}
		const shade = ctx.createLinearGradient(0, 30, 0, 324);
		shade.addColorStop(0, "rgba(10,8,28,.08)");
		shade.addColorStop(1, "rgba(9,10,27,.82)");
		ctx.fillStyle = shade;
		ctx.fillRect(24, 24, 1152, 300);
		ctx.fillStyle = "rgba(255,255,255,.10)";
		ctx.beginPath(); ctx.moveTo(760, 24); ctx.lineTo(930, 24); ctx.lineTo(720, 324); ctx.lineTo(550, 324); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,.07)";
		ctx.beginPath(); ctx.moveTo(970, 24); ctx.lineTo(1160, 24); ctx.lineTo(950, 324); ctx.lineTo(760, 324); ctx.fill();
		ctx.restore();
		ctx.fillStyle = "rgba(16,18,38,.92)";
		roundRect(ctx, 24, 286, 1152, 365, 34);
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,.09)";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	private drawAvatar(ctx: any, avatar: any, user: User): void {
		ctx.save();
		ctx.shadowColor = "rgba(0,0,0,.45)";
		ctx.shadowBlur = 28;
		ctx.fillStyle = "#f5d0fe";
		ctx.beginPath(); ctx.arc(190, 292, 116, 0, Math.PI * 2); ctx.fill();
		ctx.shadowBlur = 0;
		ctx.beginPath(); ctx.arc(190, 292, 106, 0, Math.PI * 2); ctx.clip();
		if (avatar) cover(ctx, avatar, 84, 186, 212, 212);
		else {
			const fallback = ctx.createLinearGradient(84, 186, 296, 398);
			fallback.addColorStop(0, "#a855f7"); fallback.addColorStop(1, "#06b6d4");
			ctx.fillStyle = fallback; ctx.fillRect(84, 186, 212, 212);
			ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
			ctx.font = "96px Poppins-Bold";
			ctx.fillText(sanitizeProfileText(user.globalName ?? user.username, 1).toUpperCase() || "?", 190, 298);
		}
		ctx.restore();
	}

	private drawIdentity(ctx: any, input: ProfileCardRenderInput): void {
		const { user } = input;
		ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
		ctx.fillStyle = "#ffffff"; ctx.font = "44px Poppins-Bold";
		ctx.fillText(sanitizeProfileText(user.globalName ?? user.username, 28) || "Unknown user", 330, 337, 610);
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

	private chip(ctx: any, label: string, value: string, x: number, y: number, width: number): void {
		ctx.fillStyle = "rgba(255,255,255,.055)"; roundRect(ctx, x, y, width, 62, 16); ctx.fill();
		ctx.fillStyle = "#8f8cad"; ctx.font = "13px Poppins-Bold"; ctx.textAlign = "left";
		ctx.fillText(label.toUpperCase(), x + 18, y + 23);
		ctx.fillStyle = "#f7f5ff"; ctx.font = "17px Poppins-Regular";
		ctx.fillText(sanitizeProfileText(value, 30), x + 18, y + 48, width - 32);
	}

	private drawDetails(
		ctx: any, input: ProfileCardRenderInput,
		badges: ReturnType<typeof badgeEntries>, badgeImages: any[],
	): void {
		const created = new Date(input.user.createdTimestamp).toLocaleDateString("en-US", {
			year: "numeric", month: "short", day: "2-digit", timeZone: "UTC",
		});
		this.chip(ctx, "User ID", input.user.id, 70, 420, 330);
		this.chip(ctx, "Created", created, 415, 420, 300);
		this.chip(ctx, "Account", input.user.bot ? "Bot account" : "Human account", 730, 420, 400);
		if (input.premium) {
			ctx.fillStyle = "#a6a2c6"; ctx.font = "14px Poppins-Bold"; ctx.textAlign = "left";
			ctx.fillText("BIO", 70, 520);
			const bio = sanitizeProfileText(input.profile?.bio || "No bio set — a quiet story waiting to be written.", 150);
			ctx.fillStyle = "#f2efff"; ctx.font = "18px Poppins-Regular";
			this.wrappedText(ctx, bio, 70, 550, 590, 27, 2);
			this.drawBadges(ctx, badges, badgeImages);
		} else {
			ctx.fillStyle = "#aaa7c8"; ctx.font = "17px Poppins-Regular"; ctx.textAlign = "left";
			ctx.fillText("A clean glimpse of this adventurer's Discord journey.", 70, 555);
		}
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
			if (line) ctx.fillText(row === lines - 1 ? sanitizeProfileText(`${line}…`, 90) : line, x, y + row * lineHeight, width);
			row += 1;
			if (row >= lines) return;
			line = word;
		}
		if (line && row < lines) ctx.fillText(line, x, y + row * lineHeight, width);
	}

	private drawBadges(ctx: any, badges: ReturnType<typeof badgeEntries>, images: any[]): void {
		ctx.fillStyle = "#a6a2c6"; ctx.font = "14px Poppins-Bold"; ctx.textAlign = "left";
		ctx.fillText("BADGES", 720, 520);
		if (!badges.entries.length) {
			ctx.fillStyle = "#777493"; ctx.font = "16px Poppins-Regular";
			ctx.fillText("No badges assigned", 720, 558);
			return;
		}
		for (let index = 0; index < Math.min(5, badges.entries.length); index += 1) {
			const x = 720 + index * 72;
			ctx.save();
			ctx.fillStyle = "rgba(255,255,255,.08)";
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
export const renderProfileCard = (input: ProfileCardRenderInput): Promise<Buffer | null> => profileCardRenderer.render(input);