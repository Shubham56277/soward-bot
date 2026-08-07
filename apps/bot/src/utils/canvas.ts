import path from "node:path";
import type { Guild, GuildMember } from "discord.js";
import { profileAssetLoader } from "../services/profile/ProfileAssetLoader";

/**
 * Lazily loads the native canvas binding. A missing or blocked binary must not
 * prevent the bot from starting or make image commands throw.
 */
let canvasModule: typeof import("@napi-rs/canvas") | null = null;
let canvasUnavailable = false;

export function getCanvas(): typeof import("@napi-rs/canvas") | null {
	if (canvasUnavailable) return null;
	if (canvasModule) return canvasModule;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		canvasModule = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
		const { GlobalFonts } = canvasModule;
		const base = path.resolve(__dirname, "..", "..", "fonts");
		try { GlobalFonts.registerFromPath(path.join(base, "Poppins-Bold.ttf"), "Poppins-Bold"); } catch {}
		try { GlobalFonts.registerFromPath(path.join(base, "Poppins-Regular.ttf"), "Poppins-Regular"); } catch {}
		return canvasModule;
	} catch (error: any) {
		canvasUnavailable = true;
		console.warn(
			"[canvas] @napi-rs/canvas native binary unavailable; image rendering disabled.\n" +
			`  Reason: ${error?.message ?? error}`,
		);
		return null;
	}
}

export async function createWelcomeImage(member: GuildMember, guild: Guild): Promise<Buffer | null> {
	const canvas = getCanvas();
	if (!canvas || !member || !guild) return null;
	try {
		const avatarBuffer = await profileAssetLoader.loadDiscord(
			member.user.displayAvatarURL({ extension: "webp", size: 2048 }),
		);
		const avatar = avatarBuffer ? await canvas.loadImage(avatarBuffer).catch(() => null) : null;
		const output = canvas.createCanvas(1_800, 540);
		const ctx = output.getContext("2d");
		ctx.scale(2, 2);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		(ctx as any).textRendering = "geometricPrecision";
		ctx.fillStyle = "#23272a";
		ctx.fillRect(0, 0, 900, 270);
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(200, 0);
		ctx.lineTo(340, 270);
		ctx.lineTo(0, 270);
		ctx.closePath();
		ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
		ctx.fill();

		ctx.save();
		ctx.beginPath();
		ctx.arc(140, 135, 100, 0, Math.PI * 2, true);
		ctx.closePath();
		ctx.clip();
		if (avatar) ctx.drawImage(avatar, 40, 35, 200, 200);
		else {
			ctx.fillStyle = "#5865f2";
			ctx.fillRect(40, 35, 200, 200);
		}
		ctx.restore();
		ctx.strokeStyle = "white";
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(140, 135, 100, 0, Math.PI * 2, true);
		ctx.stroke();

		ctx.fillStyle = "white";
		ctx.textAlign = "center";
		ctx.font = "bold 50px Poppins-Bold";
		ctx.fillText("WELCOME", 600, 60);
		ctx.font = "bold 30px Poppins-Bold";
		ctx.fillText(member.user.globalName ?? member.user.tag, 600, 110, 500);
		ctx.font = "bold 40px Poppins-Bold";
		ctx.fillText("YOU ARE MEMBER", 600, 160);
		ctx.font = "30px Poppins-Regular";
		ctx.fillText(`#${guild.memberCount}`, 600, 210);
		ctx.font = "18px Poppins-Regular";
		ctx.fillText("THANK YOU FOR JOINING. HOPE YOU WILL ENJOY YOUR STAY", 600, 260, 560);
		return output.toBuffer("image/webp");
	} catch {
		return null;
	}
}

/** Merges only assets accepted by the hardened HTTPS/local profile loader. */
export async function mergeImages(img1: string, img2: string): Promise<Buffer | null> {
	const canvas = getCanvas();
	if (!canvas) return null;
	try {
		const [buffer1, buffer2] = await Promise.all([
			profileAssetLoader.loadBadge(img1),
			profileAssetLoader.loadBadge(img2),
		]);
		if (!buffer1 || !buffer2) return null;
		const [image1, image2] = await Promise.all([canvas.loadImage(buffer1), canvas.loadImage(buffer2)]);
		const output = canvas.createCanvas(image1.width + image2.width, Math.max(image1.height, image2.height));
		const ctx = output.getContext("2d");
		ctx.drawImage(image1, 0, 0);
		ctx.drawImage(image2, image1.width, 0, image2.width, image2.height);
		return output.toBuffer("image/png");
	} catch {
		return null;
	}
}