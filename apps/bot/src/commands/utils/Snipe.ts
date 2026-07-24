import { ContainerBuilder, ApplicationCommandOptionType, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { messageTracker } from "../../modules/MessageTracker";
import { ContainerPagination } from "../../utils/Pagination";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}


export default class Snipe extends Command {
	constructor() {
		super({
			name: "snipe",
			description: {
				content: "View recently deleted or edited messages with pagination",
				examples: ["snipe", "snipe edit", "snipe deleted"],
				usage: "snipe [type]",
			},
			category: "utils",
			aliases: ["sniped", "snipeedit"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["ViewChannel", "EmbedLinks", "SendMessages"],
				user: [],
			},
			slashCommand: false,
			options: [
				{
					name: "type",
					description: "Type of messages to snipe (deleted or edited)",
					type: ApplicationCommandOptionType.String,
					required: false,
					choices: [
						{ name: "Deleted", value: "deleted" },
						{ name: "Edited", value: "edited" },
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// Handle arguments
		let type = ctx.options?.getString("type", false) || "deleted";

		// Handle text command
		if (!ctx.isInteraction) {
			const args = ctx.args;
			if (args[0]?.toLowerCase() === "edit" || args[0]?.toLowerCase() === "edited") {
				type = "edited";
			} else if (args[0]?.toLowerCase() === "delete" || args[0]?.toLowerCase() === "deleted") {
				type = "deleted";
			}
		}

		try {
			if (type === "edited") {
				await this.handleEditedMessages(ctx);
			} else {
				await this.handleDeletedMessages(ctx);
			}
		} catch (error) {
			console.error("Snipe Error:", error);
			await ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("<:Cross:1375519752746958858> An error occurred while trying to snipe messages"))],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}

	private async handleEditedMessages(ctx: Context): Promise<any> {
		const editedMessages = await messageTracker.getEditedMessages(ctx.client.redis, ctx.channel.id);

		if (!editedMessages || editedMessages.length === 0) {
			return await ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("No edited messages found in this channel"))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const pages: ContainerBuilder[] = [];

		editedMessages.forEach((message, index) => {
			const lines = [
				`👤 **Author:** **[${message.author}](https://discord.com/users/${message.authorId})**`,
				`🆔 **Author ID:** \`${message.authorId}\``,
				`📣 **Author Mention:** <@${message.authorId}>`,
				`🕒 **Edited:** <t:${Math.floor(message.editTimestamp / 1000)}:R>`,
			];
			if (message.oldContent) lines.push(`\n📝 **Original Content:**\n${message.oldContent}`);
			if (message.content) lines.push(`\n✏️ **Edited Content:**\n${message.content}`);
			if (message.messageId) lines.push(`\n🔗 **Message Link:** [Jump to Message](https://discord.com/channels/${ctx.guild.id}/${ctx.channel.id}/${message.messageId})`);
			lines.push(`\n-# Total Edited Messages: ${editedMessages.length} | Requested by ${ctx.author?.tag}`);
			pages.push(buildPanel(`Edited Message ${index + 1}/${editedMessages.length}`, lines.join("\n")));
		});

		const pagination = new ContainerPagination(ctx, pages);
		await pagination.start();
	}

	private async handleDeletedMessages(ctx: Context): Promise<any> {
		const deletedMessages = await messageTracker.getDeletedMessages(ctx.client.redis, ctx.channel.id);

		if (!deletedMessages || deletedMessages.length === 0) {
			return await ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("No deleted messages found in this channel"))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const pages: ContainerBuilder[] = [];

		deletedMessages.forEach((message, index) => {
			const lines = [
				`👤 **Author:** **[${message.author}](https://discord.com/users/${message.authorId})**`,
				`🆔 **Author ID:** \`${message.authorId}\``,
				`📣 **Author Mention:** <@${message.authorId}>`,
				`🕒 **Deleted:** <t:${Math.floor(message.timestamp / 1000)}:R>`,
			];
			if (message.content) lines.push(`\n📝 **Content:**\n${message.content}`);
			if (message.image) lines.push(`\n📎 **Attachment:** [View Image](${message.image})`);
			lines.push(`\n-# Total Deleted Messages: ${deletedMessages.length} | Requested by ${ctx.author?.tag}`);
			pages.push(buildPanel(`Deleted Message ${index + 1}/${deletedMessages.length}`, lines.join("\n")));
		});

		const pagination = new ContainerPagination(ctx, pages);
		await pagination.start();
	}
}