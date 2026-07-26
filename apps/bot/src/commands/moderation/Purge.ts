import {
	Collection,
	ContainerBuilder,
	Message,
	MessageFlags,
	TextBasedChannel,
	TextDisplayBuilder,
	ApplicationCommandOptionType,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function cv2(text: string) {
	return {
		components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
		flags: MessageFlags.IsComponentsV2,
	};
}

type Filter = "all" | "bots" | "links" | "embeds" | "media" | "user";

export default class Purge extends Command {
	constructor() {
		super({
			name: "purge",
			description: {
				content: "Bulk delete messages instantly with filters",
				examples: ["purge 20", "purge bots", "purge links 50", "purge media", "purge embeds 30", "purge @user 10"],
				usage: "purge [filter|amount] [amount]",
			},
			category: "moderation",
			aliases: ["clear", "prune"],
			cooldown: 5,
			args: true,
			permissions: {
				dev: false,
				client: ["ManageMessages", "ViewChannel", "SendMessages", "ReadMessageHistory"],
				user: ["ManageMessages"],
			},
			slashCommand: false,
			options: [
				{ name: "amount", description: "Number of messages (1-100, default 20)", type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 100 },
				{ name: "filter", description: "Filter type", type: ApplicationCommandOptionType.String, required: false, choices: [
					{ name: "Bots", value: "bots" },
					{ name: "Links", value: "links" },
					{ name: "Embeds", value: "embeds" },
					{ name: "Media", value: "media" },
				]},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!ctx.channel?.isTextBased() || ctx.channel.isDMBased()) {
			return ctx.sendMessage(cv2("This command can only be used in text channels."));
		}

		const channel = ctx.channel as TextBasedChannel;

		// Parse arguments
		let amount = 20;
		let filter: Filter = "all";
		let targetUserId: string | undefined;

		if (!ctx.isInteraction && ctx.args?.length) {
			for (const arg of ctx.args) {
				const lower = arg.toLowerCase();

				// Check if it's a number
				if (/^\d+$/.test(arg)) {
					const num = parseInt(arg, 10);
					if (num >= 1 && num <= 100) amount = num;
					continue;
				}

				// Check user mention
				const mentionMatch = arg.match(/^<@!?(\d+)>$/);
				if (mentionMatch) {
					targetUserId = mentionMatch[1];
					filter = "user";
					continue;
				}

				// Check filter keywords
				if (lower === "bots" || lower === "bot") filter = "bots";
				else if (lower === "links" || lower === "link") filter = "links";
				else if (lower === "embeds" || lower === "embed") filter = "embeds";
				else if (lower === "media" || lower === "photos" || lower === "attachments" || lower === "images" || lower === "files") filter = "media";
			}
		}

		// Clamp amount
		amount = Math.max(1, Math.min(100, amount));

		try {
			// Delete the command message first
			if (ctx.message) await ctx.message.delete().catch(() => {});

			// Fetch messages
			const fetched = await channel.messages.fetch({ limit: amount });
			if (!fetched.size) {
				const msg = await channel.send(cv2("No messages found."));
				setTimeout(() => msg.delete().catch(() => {}), 3_000);
				return;
			}

			// Apply filter
			let filtered: Collection<string, Message>;
			const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

			switch (filter) {
				case "bots":
					filtered = fetched.filter((m) => m.author.bot && m.createdTimestamp > twoWeeksAgo);
					break;
				case "links":
					filtered = fetched.filter((m) => /https?:\/\/\S+/.test(m.content) && m.createdTimestamp > twoWeeksAgo);
					break;
				case "embeds":
					filtered = fetched.filter((m) => m.embeds.length > 0 && m.createdTimestamp > twoWeeksAgo);
					break;
				case "media":
					filtered = fetched.filter((m) => m.attachments.size > 0 && m.createdTimestamp > twoWeeksAgo);
					break;
				case "user":
					filtered = fetched.filter((m) => m.author.id === targetUserId && m.createdTimestamp > twoWeeksAgo);
					break;
				default:
					filtered = fetched.filter((m) => m.createdTimestamp > twoWeeksAgo);
					break;
			}

			if (!filtered.size) {
				const msg = await channel.send(cv2("No messages matched the filter."));
				setTimeout(() => msg.delete().catch(() => {}), 3_000);
				return;
			}

			// Bulk delete
			const deleted = await (channel as any).bulkDelete(filtered, true).catch(() => null);
			const count = deleted?.size ?? 0;

			// Send success and auto-delete after 3 seconds
			const filterLabel = filter === "all" ? "" : ` (${filter})`;
			const msg = await channel.send(cv2(`Successfully deleted **${count}** message${count !== 1 ? "s" : ""}${filterLabel}.`));
			setTimeout(() => msg.delete().catch(() => {}), 3_000);
		} catch (error) {
			console.error("Purge Error:", error);
			const msg = await channel.send(cv2("Failed to delete messages."));
			setTimeout(() => msg.delete().catch(() => {}), 3_000);
		}
	}
}
