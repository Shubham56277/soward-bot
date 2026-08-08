import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AttachmentBuilder } from "discord.js";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { fetch } from "undici";

export default class ZipEmoji extends Command {
	constructor() {
		super({
			name: "zipemoji",
			description: {
				content: "Downloads all server emojis as a zip and sends to DMs",
				examples: ["zipemoji"],
				usage: "zipemoji",
			},
			category: "utils",
			aliases: ["emojizip"],
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
		let emojis = ctx.guild.emojis.cache;
		if (emojis.size === 0) {
			emojis = await ctx.guild.emojis.fetch();
		}
		if (emojis.size === 0) {
			return ctx.sendMessage("This server has no emojis.");
		}

		await ctx.sendMessage(`📦 Packaging **${emojis.size}** emojis. Check your DMs shortly...`);

		try {
			const archive = archiver("zip", { zlib: { level: 6 } }); // Level 6 = good balance of speed vs size
			const stream = new PassThrough();
			archive.pipe(stream);

			let successCount = 0;
			let failedCount = 0;

			// Process emojis in batches of 10 to avoid memory spikes
			const emojiArray = [...emojis.values()];
			const BATCH_SIZE = 10;

			for (let i = 0; i < emojiArray.length; i += BATCH_SIZE) {
				const batch = emojiArray.slice(i, i + BATCH_SIZE);
				const results = await Promise.allSettled(
					batch.map(async (emoji) => {
						const ext = emoji.animated ? "gif" : "png";
						const url = emoji.imageURL({ size: 512, extension: ext });
						if (!url) throw new Error("No URL");

						const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
						if (!res.ok) throw new Error(`HTTP ${res.status}`);

						const buffer = Buffer.from(await res.arrayBuffer());
						archive.append(buffer, { name: `${emoji.name}.${ext}` });
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
				return ctx.sendMessage("Failed to package any emojis.");
			}

			const attachment = new AttachmentBuilder(zipBuffer, {
				name: `${ctx.guild.name.replace(/[^a-zA-Z0-9]/g, "_")}_emojis.zip`,
			});

			const summary = `✅ **${successCount}** emojis packaged${failedCount > 0 ? ` (${failedCount} failed)` : ""}`;

			// Send to DMs
			try {
				await ctx.author!.send({ content: summary, files: [attachment] });
				await ctx.sendMessage("✅ Emoji archive sent to your DMs!");
			} catch {
				// DMs blocked — send in channel as fallback
				await ctx.sendMessage({ content: summary, files: [attachment] });
			}
		} catch (error) {
			console.error("[zipemoji]", error);
			await ctx.sendMessage("An error occurred while creating the archive.");
		}
	}
}
