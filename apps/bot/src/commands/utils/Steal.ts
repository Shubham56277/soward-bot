import { ApplicationCommandOptionType, Message, StickerFormatType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StealCommand extends Command {
	constructor() {
		super({
			name: "steal",
			description: {
				content: "Steal emojis or stickers and add them to this server.",
				examples: ["steal :emoji:", "steal (reply to message)"],
				usage: "steal [emoji] [name]",
			},
			category: "utils",
			cooldown: 10,
			args: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ManageGuildExpressions"],
				user: ["ManageGuildExpressions"],
			},
			slashCommand: false,
			options: [
				{ name: "emoji", description: "Emoji to steal", type: ApplicationCommandOptionType.String, required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// Get the full raw message content to find all custom emojis
		const rawContent = ctx.message?.content || "";

		// Case 1: Reply to a message — steal from replied message
		if (ctx.message?.reference?.messageId) {
			const channel = ctx.channel;
			if (!("messages" in channel)) return ctx.sendMessage("Cannot fetch messages in this channel.");

			const refMsg = await (channel as any).messages.fetch(ctx.message.reference.messageId).catch(() => null) as Message | null;
			if (!refMsg) return ctx.sendMessage("Could not fetch the replied message.");

			// Steal sticker if present
			if (refMsg.stickers.size > 0) {
				return this.stealSticker(ctx, refMsg);
			}

			// Steal custom emojis from the replied message
			const emojis = this.extractCustomEmojis(refMsg.content);
			if (emojis.length > 0) {
				return this.stealMultiple(ctx, emojis);
			}

			return ctx.sendMessage("The replied message has no custom emojis or stickers to steal.");
		}

		// Case 2: Emojis in the command message itself (e.g. "?steal :pepe: :kek:")
		const emojisInMessage = this.extractCustomEmojis(rawContent);
		if (emojisInMessage.length > 0) {
			return this.stealMultiple(ctx, emojisInMessage);
		}

		// Case 3: URL-based steal
		const input = ctx.args[0] || "";
		const emojiUrl = input.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|gif|webp)/);
		if (emojiUrl) {
			const name = this.safeName(ctx.args[1]) || this.genName(ctx.guild.name);
			return this.addEmoji(ctx, `https://cdn.discordapp.com/emojis/${emojiUrl[1]}.${emojiUrl[2]}`, name);
		}

		const stickerUrl = input.match(/https:\/\/media\.discordapp\.net\/stickers\/(\d+)\.(png|webp|gif)/);
		if (stickerUrl) {
			const name = this.safeName(ctx.args[1]) || this.genName(ctx.guild.name);
			return this.addSticker(ctx, input, name);
		}

		return ctx.sendMessage("Reply to a message with custom emojis/stickers, or send custom emojis after the command.\nDefault emojis (💚🐸) can't be stolen — only custom server emojis work.");
	}

	// ─── Extract all custom emojis from text ────────────────────────────────

	private extractCustomEmojis(text: string): Array<{ animated: boolean; name: string; id: string }> {
		const regex = /<(a?):(\w+):(\d+)>/g;
		const results: Array<{ animated: boolean; name: string; id: string }> = [];
		const seen = new Set<string>();
		let match: RegExpExecArray | null;

		while ((match = regex.exec(text)) !== null) {
			if (!seen.has(match[3]!)) {
				seen.add(match[3]!);
				results.push({ animated: match[1] === "a", name: match[2]!, id: match[3]! });
			}
		}
		return results;
	}

	// ─── Steal multiple emojis with delay ───────────────────────────────────

	private async stealMultiple(ctx: Context, emojis: Array<{ animated: boolean; name: string; id: string }>): Promise<any> {
		if (emojis.length === 1) {
			const e = emojis[0]!;
			const name = this.genName(ctx.guild.name);
			const ext = e.animated ? "gif" : "png";
			return this.addEmoji(ctx, `https://cdn.discordapp.com/emojis/${e.id}.${ext}`, name);
		}

		// Multiple emojis
		let success = 0;
		let failed = 0;
		const results: string[] = [];

		for (let i = 0; i < emojis.length; i++) {
			const e = emojis[i]!;
			const name = this.genName(ctx.guild.name);
			const ext = e.animated ? "gif" : "png";
			const url = `https://cdn.discordapp.com/emojis/${e.id}.${ext}`;

			try {
				const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
				results.push(`**${emoji.name}** ${emoji.toString()}`);
				success++;
			} catch {
				results.push(`Could not add \`${e.name}\``);
				failed++;
			}

			// Delay between each to avoid rate limits
			if (i < emojis.length - 1) await this.delay(600);
		}

		return ctx.sendMessage(`${results.join("\n")}\n-# ${success} added${failed > 0 ? `, ${failed} failed` : ""}`);
	}

	// ─── Steal sticker from replied message ─────────────────────────────────

	private async stealSticker(ctx: Context, refMsg: Message): Promise<any> {
		const sticker = refMsg.stickers.first()!;
		const name = this.genName(ctx.guild.name);

		if (sticker.format === StickerFormatType.Lottie) {
			return ctx.sendMessage("Cannot steal Lottie stickers — only PNG/APNG are supported.");
		}

		return this.addSticker(ctx, sticker.url, name);
	}

	// ─── Add emoji helper ───────────────────────────────────────────────────

	private async addEmoji(ctx: Context, url: string, name: string): Promise<any> {
		try {
			const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
			return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
		} catch (e: any) {
			// If name error, retry with a safe fallback name
			if (e.message?.includes("name") || e.code === 50035) {
				const fallback = "emoji_" + Math.floor(1000 + Math.random() * 9000);
				try {
					const emoji = await ctx.guild.emojis.create({ attachment: url, name: fallback, reason: `Stolen by ${ctx.author?.username}` });
					return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
				} catch (e2: any) {
					return ctx.sendMessage(`Failed to add emoji: ${e2.message?.slice(0, 100) ?? "Unknown error"}`);
				}
			}
			return ctx.sendMessage(`Failed to add emoji: ${e.message?.slice(0, 100) ?? "Unknown error"}`);
		}
	}

	// ─── Add sticker helper ─────────────────────────────────────────────────

	private async addSticker(ctx: Context, url: string, name: string): Promise<any> {
		try {
			const created = await ctx.guild.stickers.create({ file: url, name, tags: "emoji", reason: `Stolen by ${ctx.author?.username}` });
			return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
		} catch (e: any) {
			if (e.message?.includes("name") || e.code === 50035) {
				const fallback = "sticker_" + Math.floor(1000 + Math.random() * 9000);
				try {
					const created = await ctx.guild.stickers.create({ file: url, name: fallback, tags: "emoji", reason: `Stolen by ${ctx.author?.username}` });
					return ctx.sendMessage(`✅ Added sticker **${created.name}** to the server.`);
				} catch (e2: any) {
					return ctx.sendMessage(`Failed to add sticker: ${e2.message?.slice(0, 100) ?? "Unknown error"}`);
				}
			}
			return ctx.sendMessage(`Failed to add sticker: ${e.message?.slice(0, 100) ?? "Unknown error"}`);
		}
	}

	// ─── Name generator ─────────────────────────────────────────────────────

	/**
	 * Generate a valid Discord emoji/sticker name from server name.
	 * Rules: 2-32 chars, only [a-zA-Z0-9_], must start with a letter.
	 */
	private genName(guildName: string): string {
		// Extract only letters from server name
		const letters = guildName.replace(/[^a-zA-Z]/g, "");
		const prefix = letters.length >= 3 ? letters.slice(0, 3) : (letters || "emj");
		// 4 random digits for uniqueness
		const rand = Math.floor(1000 + Math.random() * 9000);
		return `${prefix}_${rand}`;
	}

	/**
	 * Sanitize a user-provided name to be valid for Discord.
	 * Returns null if the input can't be made valid.
	 */
	private safeName(input: string | undefined): string | null {
		if (!input) return null;
		const cleaned = input.replace(/[^a-zA-Z0-9_]/g, "");
		if (cleaned.length < 2) return null;
		// Must start with letter
		if (!/^[a-zA-Z]/.test(cleaned)) return null;
		return cleaned.slice(0, 32);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(r => setTimeout(r, ms));
	}
}
