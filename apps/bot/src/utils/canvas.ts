/**
 * canvas.ts — Welcome card and image utilities.
 *
 * @napi-rs/canvas requires a native Skia binary (.node file).
 * On Windows with Application Control / AppLocker policies the binary may be
 * blocked. We load it lazily and fall back gracefully so the rest of the bot
 * continues working even when canvas is unavailable.
 */

import { Guild, GuildMember } from "discord.js";
import { request } from "undici";
import path from "node:path";

// ── Lazy canvas loader ───────────────────────────────────────────────────────

let canvasModule: typeof import("@napi-rs/canvas") | null = null;
let canvasUnavailable = false;

function getCanvas(): typeof import("@napi-rs/canvas") | null {
	if (canvasUnavailable) return null;
	if (canvasModule) return canvasModule;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		canvasModule = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");

		// Register fonts only once, right after a successful load
		const { GlobalFonts } = canvasModule;
		const base = path.resolve(__dirname, "..", "..", "..", "fonts");
		try { GlobalFonts.registerFromPath(path.join(base, "Poppins-Bold.ttf"),    "Poppins-Bold");    } catch {}
		try { GlobalFonts.registerFromPath(path.join(base, "Poppins-Regular.ttf"), "Poppins-Regular"); } catch {}

		return canvasModule;
	} catch (err: any) {
		canvasUnavailable = true;
		console.warn(
			"[canvas] @napi-rs/canvas native binary unavailable — welcome cards and Ship command disabled.\n" +
			`  Reason: ${err?.message ?? err}`,
		);
		return null;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createWelcomeImage(member: GuildMember, guild: Guild): Promise<Buffer | null> {
	const canvas = getCanvas();
	if (!canvas) return null; // caller must handle null gracefully

	if (!member || !guild) throw new Error("Member and guild are required");

	const { createCanvas: mkCanvas, loadImage } = canvas;

	const c   = mkCanvas(900 * 2, 270 * 2);
	const ctx = c.getContext("2d");
	ctx.scale(2, 2);
	ctx.imageSmoothingEnabled  = true;
	ctx.imageSmoothingQuality  = "high";
	(ctx as any).textRendering = "geometricPrecision";

	ctx.fillStyle = "#23272a";
	ctx.fillRect(0, 0, c.width, c.height);

	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(200, 0);
	ctx.lineTo(340, 270);
	ctx.lineTo(0, 270);
	ctx.closePath();
	ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
	ctx.fill();

	const profileSize = 200;
	ctx.save();
	ctx.beginPath();
	ctx.arc(140, 135, profileSize / 2, 0, Math.PI * 2, true);
	ctx.closePath();
	ctx.clip();

	const url = member.user.displayAvatarURL({ extension: "webp", size: 2048 });
	const { body, statusCode } = await request(url);
	if (statusCode === 200) {
		const buffer = await body.arrayBuffer();
		const image  = await loadImage(Buffer.from(buffer));
		ctx.drawImage(image, 40, 35, profileSize, profileSize);
		ctx.strokeStyle = "white";
		ctx.lineWidth   = 3;
		ctx.beginPath();
		ctx.arc(140, 135, profileSize / 2, 0, Math.PI * 2, true);
		ctx.stroke();
		ctx.restore();
	} else {
		ctx.restore();
	}

	ctx.fillStyle = "white";
	ctx.font      = "bold 50px Poppins-Bold";
	ctx.textAlign = "center";
	ctx.fillText("WELCOME", 600, 60);
	ctx.font = "bold 30px Poppins-Bold";
	ctx.fillText(member.user.globalName ?? member.user.tag, 600, 110);
	ctx.font = "bold 40px Poppins-Bold";
	ctx.fillText("YOU ARE MEMBER", 600, 160);
	ctx.font = "30px Poppins-Regular";
	ctx.fillText(`#${guild.memberCount}`, 600, 210);
	ctx.font = "18px Poppins-Regular";
	ctx.fillText("THANK YOU FOR JOINING. HOPE YOU WILL ENJOY YOUR STAY", 600, 260);

	return c.toBuffer("image/webp");
}

export async function mergeImages(img1: string, img2: string): Promise<Buffer | null> {
	const cv = getCanvas();
	if (!cv) return null;

	try {
		const [r1, r2] = await Promise.all([request(img1), request(img2)]);
		const [b1, b2] = await Promise.all([r1.body.arrayBuffer(), r2.body.arrayBuffer()]);
		const [i1, i2] = await Promise.all([
			cv.loadImage(Buffer.from(b1)),
			cv.loadImage(Buffer.from(b2)),
		]);
		const c   = cv.createCanvas(i1.width + i2.width, Math.max(i1.height, i2.height));
		const ctx = c.getContext("2d");
		ctx.drawImage(i1, 0, 0);
		ctx.drawImage(i2, i1.width, 0, i2.width, i2.height);
		return c.toBuffer("image/png");
	} catch (err) {
		console.error("[mergeImages] failed:", err);
		return null;
	}
}
