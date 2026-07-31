import { ApplicationCommandOptionType, Message, StickerFormatType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StealCommand extends Command {
	constructor() {
		super({
			name: "steal",
			description: {
				content: "Steal an emoji or sticker and add it to this server. Reply to a sticker message to steal stickers.",
				examples: ["steal :emoji:", "steal (reply to sticker)"],
				usage: "steal <emoji> [name] OR reply to a sticker message",
			},
			category: "utils",
			cooldown: 10,
			args: false, // Allow no args (reply-based sticker steal)
			permissions: {
				dev: false,
				client: ["SendMessages", "ManageGuildExpressions"],
				user: ["ManageGuildExpressions"],
			},
			slashCommand: false,
			options: [
				{ name: "emoji", description: "Emoji to steal", type: ApplicationCommandOptionType.String, required: false },
				{ name: "name", description: "Name for the emoji/sticker", type: ApplicationCommandOptionType.String, required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const input = ctx.args[0];

		// Case 1: Reply to a message with a sticker
		if (ctx.message?.reference?.messageId) {
			const channel = ctx.channel;
			if (!("messages" in channel)) return ctx.sendMessage("Cannot fetch messages in this channel.");

			const refMsg = await (channel as any).messages.fetch(ctx.message.reference.messageId).catch(() => null) as Message | null;
			if (!refMsg) return ctx.sendMessage("Could not fetch the replied message.");

			// Check if the replied message has stickers
			if (refMsg.stickers.size > 0) {
				const sticker = refMsg.stickers.first()!;
				const stickerName = ctx.args[0] || this.generateName(ctx.guild.name);

				// Only PNG/APNG stickers can be added (not Lottie)
				if (sticker.format === StickerFormatType.Lottie) {
					return ctx.sendMessage("Cannot steal Lottie stickers (animated JSON format). Only PNG/APNG stickers are supported.");
				}

				try {
					const created = await ctx.guild.stickers.create({
						file: sticker.url,
						name: stickerName,
						tags: sticker.tags ?? "emoji",
						reason: `Stolen by ${ctx.author?.username}`,
					});
					return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
				} catch (e: any) {
					return ctx.sendMessage(`Failed to add sticker: ${e.message ?? "Unknown error"}`);
				}
			}

			// Check if replied message has custom emojis in content
			const emojiMatch = refMsg.content.match(/<(a?):(\w+):(\d+)>/);
			if (emojiMatch) {
				return this.stealEmoji(ctx, emojiMatch);
			}

			return ctx.sendMessage("The replied message has no stickers or custom emojis to steal.");
		}

		// Case 2: Steal emoji from args
		if (!input) {
			return ctx.sendMessage("Reply to a message with a sticker, or provide an emoji: `steal :emoji:` or reply to a sticker message.");
		}

		// Parse custom emoji format <:name:id> or <a:name:id>
		const emojiMatch = input.match(/<(a?):(\w+):(\d+)>/);
		if (emojiMatch) {
			return this.stealEmoji(ctx, emojiMatch);
		}

		// Try URL
		const urlMatch = input.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|gif|webp)/);
		if (urlMatch) {
			const id = urlMatch[1];
			const ext = urlMatch[2];
			const name = ctx.args[1] || this.generateName(ctx.guild.name);
			const url = `https://cdn.discordapp.com/emojis/${id}.${ext}`;

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
			const name = ctx.args[1] || this.generateName(ctx.guild.name);
			try {
				const created = await ctx.guild.stickers.create({
					file: input,
					name,
					tags: "emoji",
					reason: `Stolen by ${ctx.author?.username}`,
				});
				return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
			} catch (e: any) {
				return ctx.sendMessage(`Failed to add sticker: ${e.message ?? "Unknown error"}`);
			}
		}

		return ctx.sendMessage("Provide a valid custom emoji, emoji URL, sticker URL, or reply to a sticker message.");
	}

	private async stealEmoji(ctx: Context, match: RegExpMatchArray): Promise<any> {
		const animated = match[1] === "a";
		const originalName = match[2]!;
		const emojiId = match[3];
		const ext = animated ? "gif" : "png";
		const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;

		// Use custom name from args[1] if available, otherwise use original emoji name
		const emojiName = ctx.args[1] || originalName;

		try {
			const emoji = await ctx.guild.emojis.create({ attachment: url, name: emojiName, reason: `Stolen by ${ctx.author?.username}` });
			return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
		} catch (e: any) {
			return ctx.sendMessage(`Failed to add emoji: ${e.message ?? "Unknown error"}`);
		}
	}

	/**
	 * Generate a default name from the server name.
	 * Takes first 2 words, replaces non-alphanumeric with _, appends 2 random digits.
	 * e.g. "Developer Verse Community" → "Developer_Verse_47"
	 */
	private generateName(guildName: string): string {
		const words = guildName.trim().split(/\s+/).slice(0, 2);
		const base = words.join("_").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
		const rand = Math.floor(Math.random() * 90 + 10); // 10-99
		return `${base}_${rand}`;
	}
}
