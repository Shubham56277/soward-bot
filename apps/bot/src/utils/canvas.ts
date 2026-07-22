import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { Guild, GuildMember } from "discord.js";
import { request } from "undici";
import path from "node:path";


GlobalFonts.registerFromPath(path.resolve(__dirname, "..", "..", "..", "fonts", "Poppins-Bold.ttf"), "Poppins-Bold");
GlobalFonts.registerFromPath(path.resolve(__dirname, "..", "..", "..", "fonts", "Poppins-Regular.ttf"), "Poppins-Regular");


export async function createWelcomeImage(member: GuildMember, guild: Guild) {
	if (!member || !guild) {
		throw new Error("Member and guild are required");
	}

	// Create a canvas with width and height
	const canvas = createCanvas(900 * 2, 270 * 2);
	const ctx = canvas.getContext("2d");
	// Set scaling for increased resolution
	ctx.scale(2, 2);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.textRendering = "geometricPrecision";

	// Draw background
	ctx.fillStyle = "#23272a";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Left shape
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(200, 0); // top line
	ctx.lineTo(340, 270); // right line
	ctx.lineTo(0, 270); // bottom line
	ctx.closePath();
	ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
	ctx.fill();

	// Draw profile picture
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
		const image = await loadImage(Buffer.from(buffer));
		if (!image) {
			throw new Error("Failed to load image");
		}
		ctx.drawImage(image, 40, 35, profileSize, profileSize);
		ctx.strokeStyle = "white";
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(140, 135, profileSize / 2, 0, Math.PI * 2, true);
		ctx.stroke();
		ctx.restore();
	} else {
		throw new Error(`Failed to load image, status code: ${statusCode}`);
	}

	// Draw text
	ctx.fillStyle = "white";
	ctx.font = "bold 50px Poppins-Bold";
	ctx.textAlign = "center";
	ctx.fillText("WELCOME", 600, 60);

	ctx.font = "bold 30px Poppins-Bold";
	ctx.fillText(member.user.globalName ? member.user.globalName : member.user.tag, 600, 110);

	ctx.font = "bold 40px Poppins-Bold";
	ctx.fillText("YOU ARE MEMBER", 600, 160);

	ctx.font = "30px Poppins-Regular";
	ctx.fillText(`#${guild.memberCount}`, 600, 210);

	ctx.font = "18px Poppins-Regular";
	ctx.fillText("THANK YOU FOR JOINING. HOPE YOU WILL ENJOY YOUR STAY", 600, 260);

	// Return the canvas as a buffer
	return canvas.toBuffer("image/webp");
}

export async function mergeImages(img1: any, img2: any): Promise<any> {
	if (!img1 || !img2) return null;
	try {
		const [image1Buffer, image2Buffer] = await Promise.all([
			request(img1),
			request(img2),
		]).then(async ([image1Response, image2Response]) => {
			const image1Buffer = await image1Response.body.arrayBuffer();
			const image2Buffer = await image2Response.body.arrayBuffer();
			return [image1Buffer, image2Buffer];
		});

		const [image1, image2] = await Promise.all([loadImage(Buffer.from(image1Buffer ?? new ArrayBuffer(0))), loadImage(Buffer.from(image2Buffer ?? new ArrayBuffer(0)))]);

		const canvas = createCanvas(image1.width + image2.width, Math.max(image1.height, image2.height))
		const ctx = canvas.getContext('2d');
		ctx.drawImage(image1, 0, 0);
		ctx.drawImage(image2, image1.width, 0, image2.width, image2.height);
		const mergedImageBuffer = canvas.toBuffer('image/png');
		return mergedImageBuffer;
	} catch (error) {
		console.log(error);
		return null;
	}
}