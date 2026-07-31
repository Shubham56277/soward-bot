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
				return ctx.sendMessage("The replied message has no custom emojis or stickers to steal.");
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
	 * Takes first 2-3 letters of first 2 words + 4 random digits.
	 * e.g. "Developer Verse" → "Dev_Ver_3847"
	 * e.g. "Only eating" → "Onl_eat_9214"
	 * Always unique due to random suffix.
	 */
	private genName(guildName: string): string {
		const words = guildName.trim().split(/\s+/).filter(Boolean);
		let prefix: string;

		if (words.length >= 2) {
			// Take 3 chars from first word + 3 chars from second word
			prefix = words[0]!.slice(0, 3) + "_" + words[1]!.slice(0, 3);
		} else {
			// Single word — take first 5 chars
			prefix = (words[0] || "srv").slice(0, 5);
		}

		// Clean non-alphanumeric
		prefix = prefix.replace(/[^a-zA-Z0-9_]/g, "");
		if (!prefix) prefix = "emoji";

		// 4 random digits (always unique)
		const rand = Math.floor(1000 + Math.random() * 9000);
		return `${prefix}_${rand}`;
	}
}
