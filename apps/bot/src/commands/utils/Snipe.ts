import { EmbedBuilder, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { messageTracker } from "../../modules/MessageTracker";
import { Pagination } from "../../utils/Pagination";


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
			const embed = new EmbedBuilder()
				.setColor(Colors.Red)
				.setDescription("<:Cross:1375519752746958858> An error occurred while trying to snipe messages");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}

	private async handleEditedMessages(ctx: Context): Promise<any> {
		const editedMessages = await messageTracker.getEditedMessages(ctx.client.redis, ctx.channel.id);

		if (!editedMessages || editedMessages.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Red)
				.setDescription("No edited messages found in this channel");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		const messagesPerPage = 1;
		const embedPages: EmbedBuilder[] = [];

		editedMessages.forEach((message, index) => {
			const embed = new EmbedBuilder()
				.setColor(Colors.Blue)
				.setAuthor({
					name: `Edited Message ${index + 1}/${editedMessages.length}`,
					iconURL: message.authorAvatar || ctx.client.user?.displayAvatarURL()
				})
				.setDescription(`👤 **Author:** **[${message.author}](https://discord.com/users/${message.authorId})**\n` +
					`🆔 **Author ID:** \`${message.authorId}\`\n` +
					`📣 **Author Mention:** <@${message.authorId}>\n` +
					`🕒 **Edited:** <t:${Math.floor(message.editTimestamp / 1000)}:R>`)
				.setFooter({
					text: `Total Edited Messages: ${editedMessages.length} | Requested by ${ctx.author?.tag}`,
					iconURL: ctx.author?.displayAvatarURL()
				});

			if (message.oldContent) {
				embed.addFields({ name: '📝 **Original Content:**', value: message.oldContent });
			}
			if (message.content) {
				embed.addFields({ name: '✏️ **Edited Content:**', value: message.content });
			}

			if (message.messageId) {
				embed.addFields({
					name: '🔗 **Message Link:**',
					value: `[Jump to Message](https://discord.com/channels/${ctx.guild.id}/${ctx.channel.id}/${message.messageId})`
				});
			}

			embedPages.push(embed);
		});

		const pagination = new Pagination(ctx, embedPages);
		await pagination.start();
	}

	private async handleDeletedMessages(ctx: Context): Promise<any> {
		const deletedMessages = await messageTracker.getDeletedMessages(ctx.client.redis, ctx.channel.id);

		if (!deletedMessages || deletedMessages.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Red)
				.setDescription("No deleted messages found in this channel");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		const messagesPerPage = 1;
		const embedPages: EmbedBuilder[] = [];

		deletedMessages.forEach((message, index) => {
			const embed = new EmbedBuilder()
				.setColor(Colors.Red)
				.setAuthor({
					name: `Deleted Message ${index + 1}/${deletedMessages.length}`,
					iconURL: message.authorAvatar || ctx.client.user?.displayAvatarURL()
				})
				.setDescription(`👤 **Author:** **[${message.author}](https://discord.com/users/${message.authorId})**\n` +
					`🆔 **Author ID:** \`${message.authorId}\`\n` +
					`📣 **Author Mention:** <@${message.authorId}>\n` +
					`🕒 **Deleted:** <t:${Math.floor(message.timestamp / 1000)}:R>`)
				.setFooter({
					text: `Total Deleted Messages: ${deletedMessages.length} | Requested by ${ctx.author?.tag}`,
					iconURL: ctx.author?.displayAvatarURL()
				});

			if (message.content) {
				embed.addFields({ name: '📝 **Content:**', value: message.content });
			}

			if (message.image) {
				embed.setImage(message.image);
				embed.addFields({ name: '📎 **Attachment:**', value: `[View Image](${message.image})` });
			}

			embedPages.push(embed);
		});

		const pagination = new Pagination(ctx, embedPages);
		await pagination.start();
	}
}