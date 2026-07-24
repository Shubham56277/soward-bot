import {
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	ApplicationCommandOptionType,
	MessageFlags,
	User,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { purgeMessages, PurgeType } from "../../utils/functions/purgeMessages";

function cv2(text: string): any {
	return {
		components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
		flags: MessageFlags.IsComponentsV2,
	};
}

export default class Purge extends Command {

	constructor() {
		super({
			name: "purge",
			description: {
				content: "Bulk delete messages with advanced filters",
				examples: [
					"purge",
					"purge @user",
					"purge bot 50",
					"purge links",
					"purge attachments 25",
				],
				usage: "purge [filter] [@user] [content] [amount]",
			},
			category: "moderation",
			aliases: ["clear", "prune"],
			cooldown: 10,
			args: false,
			permissions: {
				dev: false,
				client: ["ManageMessages", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ManageMessages"],
			},
			slashCommand: false,
			options: [
				{
					name: "filter",
					description: "Filter to apply",
					type: ApplicationCommandOptionType.String,
					required: false,
					choices: [
						{ name: "All Messages", value: "ALL" },
						{ name: "User Messages", value: "USER" },
						{ name: "Bot Messages", value: "BOT" },
						{ name: "Links", value: "LINK" },
						{ name: "Attachments", value: "ATTACHMENT" },
						{ name: "Contains Text", value: "TOKEN" },
					],
				},
				{
					name: "user",
					description: "User to filter by",
					type: ApplicationCommandOptionType.User,
					required: false,
				},
				{
					name: "content",
					description: "Content to search for in messages",
					type: ApplicationCommandOptionType.String,
					required: false,
				},
				{
					name: "silent",
					description: "Don't show the result message",
					type: ApplicationCommandOptionType.Boolean,
					required: false,
				},
				{
					name: "amount",
					description: "Number of messages to delete (1-100, default: 100)",
					type: ApplicationCommandOptionType.Integer,
					required: false,
					min_value: 1,
					max_value: 100,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!ctx.channel?.isTextBased() || ctx.channel.isDMBased()) {
			return ctx.sendMessage({
				...cv2("<:Cross:1375519752746958858> This command can only be used in text channels."),
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			});
		}

		let amount = ctx.options?.getInteger("amount", false) || 100;
		let filterType: PurgeType = "ALL";
		let targetUser = ctx.options?.getUser("user", false) as User | undefined;
		let contentFilter = ctx.options?.getString("content", false);
		const silent = ctx.options?.getBoolean("silent", false) ?? false;

		// Handle text command
		if (!ctx.isInteraction && ctx.args?.length) {
			const args = ctx.args;

			// Default amount to 100
			amount = 100;

			// Parse filters from text command
			const userMentionRegex = /<@!?(\d+)>/;

			// First check if there's a user mention
			if (ctx.message && ctx.message.mentions.users.size > 0) {
				targetUser = ctx.message.mentions.users.first();
				filterType = "USER"; // Set filter type to USER when a mention is provided
			}

			// Process arguments
			for (let i = 0; i < args.length; i++) {
				const arg = args[i].toLowerCase();

				// Check if it's a number (amount) - process last
				if (/^\d+$/.test(arg)) {
					const numValue = Number.parseInt(arg, 10);
					if (numValue >= 1 && numValue <= 100) {
						amount = numValue;
					}
					continue;
				}

				// Skip this iteration if it's the user mention we already processed
				if (userMentionRegex.test(arg) && targetUser) continue;

				if (arg === "bot" || arg === "bots") {
					filterType = "BOT";
				} else if (arg === "links") {
					filterType = "LINK";
				} else if (["attachments", "images", "files"].includes(arg)) {
					filterType = "ATTACHMENT";
				} else if (arg === "user") {
					filterType = "USER";
					if (args[i + 1]) {
						try {
							targetUser = await ctx.client.users.fetch(args[i + 1].replace(/[<@!>]/g, ""));
							i++; // Skip next arg since we used it as user ID
						} catch {
							return ctx.sendMessage({
								...cv2("<:Cross:1375519752746958858> Could not find the specified user"),
								flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
							});
						}
					}
				} else if ((arg === "content" || arg === "token") && args[i + 1]) {
					filterType = "TOKEN";
					// Find the content - everything that's not a number at the end
					const contentArgs = [];
					for (let j = i + 1; j < args.length; j++) {
						if (!/^\d+$/.test(args[j]) || j === args.length - 1) {
							contentArgs.push(args[j]);
						} else {
							break;
						}
					}
					contentFilter = contentArgs.join(" ");
					i = i + contentArgs.length; // Skip processed args
				} else if (userMentionRegex.test(arg) && !targetUser) {
					try {
						targetUser = await ctx.client.users.fetch(arg.replace(userMentionRegex, "$1"));
						filterType = "USER"; // Set filter type to USER when a mention is provided
					} catch {
						return ctx.sendMessage({
							...cv2("<:Cross:1375519752746958858> Could not find the specified user"),
							flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
						});
					}
				} else if (!filterType || filterType === "ALL") {
					// If no filter is set yet, treat unknown args as potential content filter
					filterType = "TOKEN";
					const contentArgs = [];
					for (let j = i; j < args.length; j++) {
						if (!/^\d+$/.test(args[j]) || j === args.length - 1) {
							contentArgs.push(args[j]);
						} else {
							break;
						}
					}
					contentFilter = contentArgs.join(" ");
					i = i + contentArgs.length - 1; // Skip processed args
				}
			}
		} else if (ctx.isInteraction) {
			// Handle slash command
			const filter = ctx.options?.getString("filter", false) as PurgeType | null;
			if (filter) {
				filterType = filter;
			}

			// If user is specified but filter type isn't USER, set it to USER
			if (targetUser && filterType === "ALL") {
				filterType = "USER";
			}
		}

		// Validate filters
		if (filterType === "USER" && !targetUser) {
			return ctx.sendMessage({
				...cv2("<:Cross:1375519752746958858> Please specify a user when using the 'user' filter"),
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			});
		}

		if (filterType === "TOKEN" && !contentFilter) {
			return ctx.sendMessage({
				...cv2("<:Cross:1375519752746958858> Please specify content to search for when using the 'content' filter"),
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			});
		}

		// Enforce limits
		if (amount > 100) amount = 100;
		if (amount < 1) amount = 1;

		// Use the purgeMessages utility function
		await purgeMessages(
			ctx.member!,
			ctx.channel,
			filterType,
			amount,
			filterType === "USER" ? targetUser?.id : contentFilter
		).then(async (result) => {
			// Helper function to create result container
			const createResultContainer = (): ContainerBuilder => {
				if (typeof result === "number") {
					return new ContainerBuilder().addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`<:Tick:1375519268292264012> Successfully deleted ${result} messages${filterType !== "ALL" ? ` (filter: ${filterType}${filterType === "USER" && targetUser ? ` - ${targetUser.tag || targetUser.username}` : ""})` : ""
							}${filterType === "TOKEN" && contentFilter ? ` containing "${contentFilter}"` : ""}`,
						)
					);
				} else {
					// Handle error codes
					switch (result) {
						case "MEMBER_PERM":
							return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> You don't have permission to delete messages in this channel."));
						case "BOT_PERM":
							return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> I don't have permission to delete messages in this channel."));
						case "NO_MESSAGES":
							return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> No messages found matching your criteria."));
						default:
							return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> Failed to delete messages. Messages might be too old (>14 days)."));
					}
				}
			};

			// Handle the result - unified for both slash and text commands
			if (ctx.isInteraction) {
				// For slash commands, always respond (ephemeral if silent)
				await ctx.sendMessage({
					components: [createResultContainer()],
					flags: silent ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
				});
			} else {
				try {
					const resultMessage = await ctx.sendMessage({
						components: [createResultContainer()],
						flags: MessageFlags.IsComponentsV2,
					});
					setTimeout(() => resultMessage.delete().catch(() => { }), 5000);
				} catch (error) {
					console.error("Failed to send result message:", error);
				}
			}
		});
	}
}
