import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { messageTracker } from "../../modules/MessageTracker";

const V2 = MessageFlags.IsComponentsV2;
const NO_PING = { parse: [] as const };

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/** Neutralize any user/role/@everyone mentions so sniped content never pings. */
function noPing(text: string | null | undefined): string {
	return String(text ?? "").replace(/@/g, "@\u200b");
}

export default class Snipe extends Command {
	constructor() {
		super({
			name: "snipe",
			description: {
				content: "View recently deleted or edited messages",
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
		let type = ctx.options?.getString("type", false) || "deleted";
		if (!ctx.isInteraction) {
			const first = ctx.args[0]?.toLowerCase();
			if (first === "edit" || first === "edited") type = "edited";
			else if (first === "delete" || first === "deleted") type = "deleted";
		}

		try {
			if (type === "edited") return this.handleEditedMessages(ctx);
			return this.handleDeletedMessages(ctx);
		} catch (error) {
			console.error("Snipe Error:", error);
			await ctx.sendMessage({
				components: [buildPanel("Snipe", "An error occurred while trying to snipe messages.")],
				flags: V2,
				allowedMentions: NO_PING,
			});
		}
	}

	private async handleEditedMessages(ctx: Context): Promise<any> {
		const messages = await messageTracker.getEditedMessages(ctx.client.redis, ctx.channel.id);
		if (!messages || messages.length === 0) {
			return ctx.sendMessage({ components: [buildPanel("Snipe", "No edited messages found in this channel.")], flags: V2, allowedMentions: NO_PING });
		}

		// Latest first.
		const sorted = [...messages].sort((a, b) => b.editTimestamp - a.editTimestamp);
		const pages = sorted.map((message, index) => {
			const lines = [`**Sent by** ${noPing(message.author)} · <t:${Math.floor(message.editTimestamp / 1000)}:R>`];
			if (message.oldContent) lines.push(`**Before:** ${noPing(message.oldContent)}`);
			if (message.content) lines.push(`**After:** ${noPing(message.content)}`);
			return buildPanel(`Edited ${index + 1}/${sorted.length}`, lines.join("\n"));
		});
		return this.paginate(ctx, pages);
	}

	private async handleDeletedMessages(ctx: Context): Promise<any> {
		const messages = await messageTracker.getDeletedMessages(ctx.client.redis, ctx.channel.id);
		if (!messages || messages.length === 0) {
			return ctx.sendMessage({ components: [buildPanel("Snipe", "No deleted messages found in this channel.")], flags: V2, allowedMentions: NO_PING });
		}

		// Latest first.
		const sorted = [...messages].sort((a, b) => b.timestamp - a.timestamp);
		const pages = sorted.map((message, index) => {
			const lines = [`**Sent by** ${noPing(message.author)} · <t:${Math.floor(message.timestamp / 1000)}:R>`];
			if (message.content) lines.push(noPing(message.content));
			if (message.image) lines.push(`[Attachment](${message.image})`);
			return buildPanel(`Deleted ${index + 1}/${sorted.length}`, lines.join("\n"));
		});
		return this.paginate(ctx, pages);
	}

	/** Minimal paginator: left / delete / right, starting on the latest entry. */
	private async paginate(ctx: Context, pages: ContainerBuilder[]): Promise<any> {
		let index = 0;
		const nav = (disabled = false) =>
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("snipe_prev").setLabel("←").setStyle(ButtonStyle.Secondary).setDisabled(disabled || index === 0),
				new ButtonBuilder().setCustomId("snipe_delete").setLabel("Delete").setStyle(ButtonStyle.Danger).setDisabled(disabled),
				new ButtonBuilder().setCustomId("snipe_next").setLabel("→").setStyle(ButtonStyle.Secondary).setDisabled(disabled || index === pages.length - 1),
			);

		const message = await ctx.sendMessage({ components: [pages[0]!, nav()], flags: V2, allowedMentions: NO_PING });

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 120_000,
			filter: (interaction) => interaction.user.id === ctx.author?.id,
		});

		collector.on("collect", async (interaction) => {
			if (interaction.customId === "snipe_delete") {
				await interaction.deferUpdate().catch(() => {});
				await message.delete().catch(() => {});
				collector.stop("deleted");
				return;
			}
			if (interaction.customId === "snipe_prev") index = Math.max(0, index - 1);
			else if (interaction.customId === "snipe_next") index = Math.min(pages.length - 1, index + 1);
			await interaction.update({ components: [pages[index]!, nav()] }).catch(() => {});
		});

		collector.on("end", (_collected, reason) => {
			if (reason === "deleted") return;
			if (message.editable) message.edit({ components: [pages[index]!, nav(true)] }).catch(() => {});
		});
	}
}
