import { ApplicationCommandOptionType, Message, StickerFormatType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StealCommand extends Command {
	constructor() {
		super({
			name: "steal",
			description: {
				content: "Steal emojis or stickers and add them to this server. Reply to a message to steal all emojis/stickers from it.",
				examples: ["steal :emoji:", "steal (reply to message with emojis)"],
				usage: "steal [emoji] [name]",
			},
			category: "utils",
			cooldown: 10,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ManageGuildExpressions"],
				user: ["ManageGuildExpressions"],
			},
			slashCommand: false,
			options: [
				{ name: "emoji", description: "Emoji to steal", type: ApplicationCommandOptionType.String, required: false },
				{ name: "name", description: "Custom name", type: ApplicationCommandOptionType.String, required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const input = ctx.args[0];

		// Case 1: Reply to a message — steal ALL emojis and/or sticker from it
		if (ctx.message?.reference?.messageId) {
			const channel = ctx.channel;
			if (!("messages" in channel)) return ctx.sendMessage("Cannot fetch messages in this channel.");

			const refMsg = await (channel as any).messages.fetch(ctx.message.reference.messageId).catch(() => null) as Message | null;
			if (!refMsg) return ctx.sendMessage("Could not fetch the replied message.");

			// Steal sticker if present
			if (refMsg.stickers.size > 0) {
				const sticker = refMsg.stickers.first()!;
				const name = input || this.genName(ctx.guild.name);

				if (sticker.format === StickerFormatType.Lottie) {
					return ctx.sendMessage("Cannot steal Lottie stickers. Only PNG/APNG stickers are supported.");
				}

				try {
					const created = await ctx.guild.stickers.create({
						file: sticker.url,
						name,
						tags: sticker.tags ?? "emoji",
						reason: `Stolen by ${ctx.author?.username}`,
					});
					return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
				} catch (e: any) {
					return ctx.sendMessage(`Failed to add sticker: ${e.message ?? "Unknown error"}`);
				}
			}

			// Steal ALL custom emojis from the replied message
			const emojiRegex = /<(a?):(\w+):(\d+)>/g;
			const matches = [...refMsg.content.matchAll(emojiRegex)];

			if (matches.length === 0) {
				return ctx.sendMessage("The replied message has no **custom** emojis or stickers to steal. Default emojis can't be added.");
			}

			// Deduplicate by emoji ID
			const seen = new Set<string>();
			const uniqueEmojis: RegExpMatchArray[] = [];
			for (const m of matches) {
				if (!seen.has(m[3]!)) {
					seen.add(m[3]!);
					uniqueEmojis.push(m);
				}
			}

			if (uniqueEmojis.length === 1) {
				// Single emoji — use custom name if provided, otherwise use server name
				const name = input || this.genName(ctx.guild.name);
				return this.stealOneEmoji(ctx, uniqueEmojis[0]!, name);
			}

			// Multiple emojis — steal all with unique server-based names
			await ctx.sendMessage(`Stealing **${uniqueEmojis.length}** emojis...`);

			let success = 0;
			let failed = 0;
			const results: string[] = [];

			for (const match of uniqueEmojis) {
				const name = this.genName(ctx.guild.name);
				const animated = match[1] === "a";
				const emojiId = match[3]!;
				const ext = animated ? "gif" : "png";
				const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;

				try {
					const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
					results.push(`✅ **${emoji.name}** ${emoji.toString()}`);
					success++;
				} catch (e: any) {
					results.push(`❌ Failed: ${e.message?.slice(0, 50) ?? "error"}`);
					failed++;
				}

				// Small delay between each to avoid rate limits (500ms)
				if (uniqueEmojis.indexOf(match) < uniqueEmojis.length - 1) {
					await new Promise(r => setTimeout(r, 500));
				}
			}

			const summary = results.join("\n");
			return ctx.sendMessage(`${summary}\n\n-# ${success} added, ${failed} failed`);
		}

		// Case 2: Direct emoji argument
		if (!input) {
			return ctx.sendMessage("Reply to a message with emojis/stickers, or provide an emoji: `steal :emoji:`");
		}

		// Parse custom emoji format
		const emojiMatch = input.match(/<(a?):(\w+):(\d+)>/);
		if (emojiMatch) {
			const name = ctx.args[1] || this.genName(ctx.guild.name);
			return this.stealOneEmoji(ctx, emojiMatch, name);
		}

		// Check if user sent Unicode emojis (can't be stolen)
		const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u;
		if (unicodeEmojiRegex.test(input)) {
			return ctx.sendMessage("Those are default Unicode emojis — they can't be stolen. Only **custom server emojis** (with a `:name:` format) can be added.");
		}

		// Try emoji URL
		const urlMatch = input.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|gif|webp)/);
		if (urlMatch) {
			const name = ctx.args[1] || this.genName(ctx.guild.name);
			const url = `https://cdn.discordapp.com/emojis/${urlMatch[1]}.${urlMatch[2]}`;
			try {
				const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
				return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
			} catch (e: any) {
				return ctx.sendMessage(`Failed to add emoji: ${e.message ?? "Unknown error"}`);
			}
		}

		// Try sticker URL
		const stickerUrlMatch = input.match(/https:\/\/media\.discordapp\.net\/stickers\/(\d+)\.(png|webp|gif)/);
		if (stickerUrlMatch) {
			const name = ctx.args[1] || this.genName(ctx.guild.name);
			try {
				const created = await ctx.guild.stickers.create({ file: input, name, tags: "emoji", reason: `Stolen by ${ctx.author?.username}` });
				return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
			} catch (e: any) {
				return ctx.sendMessage(`Failed to add sticker: ${e.message ?? "Unknown error"}`);
			}
		}

		return ctx.sendMessage("Provide a valid custom emoji, emoji URL, or reply to a message with emojis/stickers.");
	}

	private async stealOneEmoji(ctx: Context, match: RegExpMatchArray, name: string): Promise<any> {
		const animated = match[1] === "a";
		const emojiId = match[3]!;
		const ext = animated ? "gif" : "png";
		const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;

		try {
			const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
			return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
		} catch (e: any) {
			return ctx.sendMessage(`Failed to add emoji: ${e.message ?? "Unknown error"}`);
		}
	}

	/**
	 * Generate a unique name from server name.
	 * Discord emoji names must: be 2-32 chars, only a-z A-Z 0-9 _, start with a letter.
	 * e.g. "Developer Verse" → "Dev_Ver_3847"
	 * e.g. "~` LuCiFeR." → "LuC_iFe_9214"
	 * e.g. "서버" → "emoji_2847"
	 */
	private genName(guildName: string): string {
		// Strip non-alphanumeric except spaces, then split into words
		const cleaned = guildName.replace(/[^a-zA-Z0-9\s]/g, "").trim();
		const words = cleaned.split(/\s+/).filter(w => w.length > 0);

		let prefix: string;
		if (words.length >= 2) {
			prefix = words[0]!.slice(0, 3) + "_" + words[1]!.slice(0, 3);
		} else if (words.length === 1) {
			prefix = words[0]!.slice(0, 5);
		} else {
			prefix = "emoji";
		}

		// Ensure starts with a letter
		if (!/^[a-zA-Z]/.test(prefix)) {
			prefix = "e" + prefix;
		}

		// 4 random digits
		const rand = Math.floor(1000 + Math.random() * 9000);
		const name = `${prefix}_${rand}`;

		// Final safety: ensure 2-32 chars, only valid chars
		return name.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32) || "emoji_" + rand;
	}
}
