import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AttachmentBuilder } from "discord.js";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { fetch } from "undici";

export default class ZipSticker extends Command {
	constructor() {
		super({
			name: "zipsticker",
			description: {
				content: "Downloads all server stickers as a zip and sends to DMs",
				examples: ["zipsticker"],
				usage: "zipsticker",
			},
			category: "utils",
			aliases: ["stickerzip"],
			cooldown: 120, // 2 min cooldown to prevent spam
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "AttachFiles"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		let stickers = ctx.guild.stickers.cache;
		if (stickers.size === 0) {
			stickers = await ctx.guild.stickers.fetch();
		}
		if (stickers.size === 0) {
			return ctx.sendMessage("This server has no stickers.");
		}

		await ctx.sendMessage(`📦 Packaging **${stickers.size}** stickers. Check your DMs shortly...`);

		try {
			const archive = archiver("zip", { zlib: { level: 6 } });
			const stream = new PassThrough();
			archive.pipe(stream);

			let successCount = 0;
			let failedCount = 0;

			// Process stickers in batches of 5 (stickers are larger files)
			const stickerArray = [...stickers.values()];
			const BATCH_SIZE = 5;

			for (let i = 0; i < stickerArray.length; i += BATCH_SIZE) {
				const batch = stickerArray.slice(i, i + BATCH_SIZE);
				const results = await Promise.allSettled(
					batch.map(async (sticker) => {
						const url = sticker.url;
						if (!url) throw new Error("No URL");

						const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
						if (!res.ok) throw new Error(`HTTP ${res.status}`);

						const buffer = Buffer.from(await res.arrayBuffer());
						// Stickers can be png, apng, or lottie (json)
						const ext = sticker.format === 3 ? "json" : "png"; // 3 = Lottie
						archive.append(buffer, { name: `${sticker.name}.${ext}` });
					})
				);

				for (const r of results) {
					if (r.status === "fulfilled") successCount++;
					else failedCount++;
				}
			}

			archive.finalize();

			// Collect zip data
			const chunks: Buffer[] = [];
			for await (const chunk of stream) {
				chunks.push(chunk as Buffer);
			}

			const zipBuffer = Buffer.concat(chunks);

			if (successCount === 0) {
				return ctx.sendMessage("Failed to package any stickers.");
			}

			const attachment = new AttachmentBuilder(zipBuffer, {
				name: `${ctx.guild.name.replace(/[^a-zA-Z0-9]/g, "_")}_stickers.zip`,
			});

			const summary = `✅ **${successCount}** stickers packaged${failedCount > 0 ? ` (${failedCount} failed)` : ""}`;

			// Send to DMs
			try {
				await ctx.author!.send({ content: summary, files: [attachment] });
				await ctx.sendMessage("✅ Sticker archive sent to your DMs!");
			} catch {
				// DMs blocked — send in channel as fallback
				await ctx.sendMessage({ content: summary, files: [attachment] });
			}
		} catch (error) {
			console.error("[zipsticker]", error);
			await ctx.sendMessage("An error occurred while creating the archive.");
		}
	}
}
