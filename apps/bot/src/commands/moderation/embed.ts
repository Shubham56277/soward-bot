import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
	EmbedBuilder,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	TextChannel,
	Message,
	ColorResolvable,
	ChannelSelectMenuBuilder,
	ChannelType,
	ComponentType,
	Colors,
} from "discord.js";
import { colors } from "../../utils/colors";

export default class EmbedBuilderCommand extends Command {
	private embed: EmbedBuilder = new EmbedBuilder();
	private message: Message | undefined;
	private TIMEOUT = 900000; // 15 minutes timeout

	constructor() {
		super({
			name: "embed",
			description: {
				content: "Create custom embeds using a user-friendly interactive builder",
				examples: ["embed"],
				usage: "embed",
			},
			category: "moderation",
			aliases: ["createembed", "embedbuilder"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: ["ManageGuild"],
			},
			slashCommand: true,
			options: [],
		});
	}

	private createInstructionEmbed() {
		return new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("🛠️ Embed Builder - Guide")
			.setDescription("Select options from the menu below to customize your embed. When you're satisfied with your creation, click **Send Embed** to choose where to send it.")
			.addFields(
				{
					name: "💡 Available Options",
					value:
						"• **Author**: Set author name, icon, and URL\n• **Title**: Add title and optional URL\n• **Description**: Main embed content\n• **Color**: Choose embed color\n• **Fields**: Add fields with name-value pairs\n• **Thumbnail**: Small image in corner\n• **Image**: Large image\n• **Footer**: Text at bottom with optional icon\n• **Timestamp**: Toggle date/time",
				},
				{ name: "🎨 Current Preview", value: "Your embed will appear above these instructions." },
			)
			.setFooter({ text: "Tip: You can reset your embed or go back at any time" });
	}

	public async run(ctx: Context): Promise<any> {
		// Initialize with an empty embed
		this.embed = new EmbedBuilder().setColor(Colors.Blue).setDescription("Your embed will appear here. Use the menu below to customize it.");

		const guideEmbed = this.createInstructionEmbed();

		// Create main menu
		const mainMenu = this.createMainMenu();

		// Create action buttons row
		const actionRow = this.createActionButtons();

		// Send initial message with embeds and components
		this.message = await ctx.editOrReply({
			embeds: [this.embed, guideEmbed],
			components: [mainMenu, actionRow],
		});

		// Set up collector for interaction
		this.setupCollector(ctx);
	}

	private createMainMenu() {
		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("embed_builder_menu")
				.setPlaceholder("✨ Select an option to customize your embed")
				.addOptions([
					new StringSelectMenuOptionBuilder().setLabel("Author").setValue("author").setDescription("Set author name, icon, and URL").setEmoji("👤"),
					new StringSelectMenuOptionBuilder().setLabel("Title").setValue("title").setDescription("Add title and optional URL").setEmoji("📝"),
					new StringSelectMenuOptionBuilder().setLabel("Description").setValue("description").setDescription("Add main content text").setEmoji("📄"),
					new StringSelectMenuOptionBuilder().setLabel("Color").setValue("color").setDescription("Choose your embed color").setEmoji("🎨"),
					new StringSelectMenuOptionBuilder().setLabel("Fields").setValue("fields").setDescription("Add name-value field pairs").setEmoji("📋"),
					new StringSelectMenuOptionBuilder().setLabel("Thumbnail").setValue("thumbnail").setDescription("Add small image in corner").setEmoji("🖼️"),
					new StringSelectMenuOptionBuilder().setLabel("Image").setValue("image").setDescription("Add large image").setEmoji("📸"),
					new StringSelectMenuOptionBuilder().setLabel("Footer").setValue("footer").setDescription("Add text at bottom with optional icon").setEmoji("🏷️"),
					new StringSelectMenuOptionBuilder().setLabel("Timestamp").setValue("timestamp").setDescription("Toggle date and time").setEmoji("🕒"),
				]),
		);
	}

	private createActionButtons() {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("send_embed").setLabel("Send Embed").setEmoji("📤").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("preview_embed").setLabel("Preview").setEmoji("👁️").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("reset_embed").setLabel("Reset").setEmoji("🔄").setStyle(ButtonStyle.Danger),
		);
	}

	private createBackButton() {
		return new ButtonBuilder().setCustomId("back_button").setLabel("Back to Menu").setEmoji("⬅️").setStyle(ButtonStyle.Secondary);
	}

	private setupCollector(ctx: Context) {
		const filter = (i: any) => {
			if (i.user.id !== ctx.author?.id) {
				i.reply({
					content: "<:Cross:1375519752746958858> This interaction is not for you.",
					flags: MessageFlags.Ephemeral,
				});
				return false;
			}
			return true;
		};

		const collector = this.message!.createMessageComponentCollector({
			filter,
			time: this.TIMEOUT,
		});

		collector.on("collect", async (i) => {
			// Handle menu selections
			if (i.isStringSelectMenu() && i.customId === "embed_builder_menu") {
				await this.handleMenuSelection(i, ctx);
			}

			// Handle button clicks
			if (i.isButton()) {
				await this.handleButtonClick(i, ctx);
			}
		});

		collector.on("end", () => {
			if (this.message?.editable) {
				this.message
					.edit({
						content: "⏱️ Embed builder session has expired.",
						components: [],
					})
					.catch(() => { });
			}
		});
	}

	private async handleMenuSelection(i: any, ctx: Context) {
		const value = i.values[0];

		switch (value) {
			case "author":
				await this.handleAuthorOption(i, ctx);
				break;
			case "title":
				await this.handleTitleOption(i);
				break;
			case "description":
				await this.handleDescriptionOption(i, ctx);
				break;
			case "color":
				await this.handleColorOption(i, ctx);
				break;
			case "thumbnail":
				await this.handleThumbnailOption(i, ctx);
				break;
			case "image":
				await this.handleImageOption(i, ctx);
				break;
			case "footer":
				await this.handleFooterOption(i, ctx);
				break;
			case "fields":
				await this.handleFieldsOption(i);
				break;
			case "timestamp":
				await this.handleTimestampOption(i);
				break;
		}
	}

	private async handleButtonClick(i: any, ctx: Context) {
		switch (i.customId) {
			case "back_button":
				await this.handleBackButton(i);
				break;
			case "send_embed":
				await this.handleSendEmbed(i, ctx);
				break;
			case "reset_embed":
				await this.handleResetEmbed(i);
				break;
			case "preview_embed":
				await this.handlePreviewEmbed(i);
				break;
			// Author buttons
			case "author_name":
				await this.handleAuthorName(i, ctx);
				break;
			case "author_icon":
				await this.handleAuthorIcon(i, ctx);
				break;
			case "author_url":
				await this.handleAuthorUrl(i, ctx);
				break;
			// Footer buttons
			case "footer_name":
				await this.handleFooterName(i, ctx);
				break;
			case "footer_icon":
				await this.handleFooterIcon(i, ctx);
				break;
			// Color preset buttons
			case "color_red":
				this.embed.setColor(Colors.Red);
				await this.updateMessage(i);
				break;
			case "color_blue":
				this.embed.setColor(Colors.Blue);
				await this.updateMessage(i);
				break;
			case "color_green":
				this.embed.setColor(Colors.Green);
				await this.updateMessage(i);
				break;
			case "color_yellow":
				this.embed.setColor(Colors.Yellow);
				await this.updateMessage(i);
				break;
			case "color_purple":
				this.embed.setColor(Colors.Purple);
				await this.updateMessage(i);
				break;
			case "color_custom":
				await this.handleCustomColor(i, ctx);
				break;
		}
	}

	private async handleBackButton(i: any) {
		const mainMenu = this.createMainMenu();
		const actionRow = this.createActionButtons();
		const guideEmbed = this.createInstructionEmbed();

		await i.update({
			embeds: [this.embed, guideEmbed],
			components: [mainMenu, actionRow],
		});
	}

	private async handleAuthorOption(i: any, ctx: Context) {
		const authorRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("author_name").setLabel("Set Name").setEmoji("✏️").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("author_icon").setLabel("Set Icon").setEmoji("🖼️").setStyle(ButtonStyle.Primary).setDisabled(!this.embed.data.author?.name),
			new ButtonBuilder().setCustomId("author_url").setLabel("Set URL").setEmoji("🔗").setStyle(ButtonStyle.Primary).setDisabled(!this.embed.data.author?.name),
			this.createBackButton(),
		);

		const guideEmbed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("Author Settings")
			.setDescription("Customize the author section of your embed.")
			.addFields(
				{ name: "📝 Instructions", value: "1. First set the author name (required)\n2. Then optionally add an icon and URL" },
				{ name: "💡 Tips", value: "• Author name appears at the top of your embed\n• Icon appears as a small image next to the author name\n• URL makes the author name clickable" },
			);

		await i.update({
			embeds: [this.embed, guideEmbed],
			components: [authorRow],
		});
	}

	private async handleAuthorName(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the author name:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg || !msg.content.trim()) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid name provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const authorName = msg.content.trim();

			// Update the author name (preserving existing icon/URL if present)
			const currentAuthor = this.embed.data.author;

			if (currentAuthor && currentAuthor.icon_url) {
				this.embed.setAuthor({
					name: authorName,
					iconURL: currentAuthor?.icon_url,
					url: currentAuthor?.url,
				});
			} else {
				this.embed.setAuthor({
					name: authorName,
				});
			}
			// Enable the other author buttons
			const components = i.message.components;
			const authorRow = components[0];

			const updatedComponents = authorRow.components.map((component: any) => {
				if (component.customId === "author_icon" || component.customId === "author_url") {
					return new ButtonBuilder()
						.setCustomId(component.customId)
						.setLabel(component.label)
						.setStyle(component.style)
						.setDisabled(false);
				}
				return component;
			});

			await msg.delete().catch(() => { });
			await i.editReply({
				content: "<:Tick:1375519268292264012> Author name updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: [
					new ActionRowBuilder().addComponents(updatedComponents),
					...components.slice(1)
				]
			});
		} catch (error) {
			console.error(error);
			await i.followUp({
				content: "<:Cross:1375519752746958858> Author name update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleAuthorIcon(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the author icon URL or upload an image:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg) return;

			let iconUrl = msg.content.trim();
			if (!iconUrl && msg.attachments.size > 0) {
				iconUrl = msg.attachments.first()?.url || "";
			}

			if (!iconUrl) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid URL or image provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			try {
				new URL(iconUrl);
			} catch (error) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid URL format. Please provide a valid URL.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const currentAuthor = this.embed.data.author;
			if (currentAuthor) {
				this.embed.setAuthor({
					name: currentAuthor.name,
					iconURL: iconUrl,
					url: currentAuthor.url,
				});
			}

			await i.editReply({
				content: "<:Tick:1375519268292264012> Author icon updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: i.message.components,
			});
			await msg.delete().catch(() => { });
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Author icon update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleAuthorUrl(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the author URL (must start with http:// or https://):",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg || !msg.content.trim()) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid URL provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const url = msg.content.trim();
			try {
				new URL(url);
			} catch (error) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid URL format. Please provide a valid URL that starts with http:// or https://",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const currentAuthor = this.embed.data.author;
			if (currentAuthor) {
				this.embed.setAuthor({
					name: currentAuthor.name,
					iconURL: currentAuthor.icon_url,
					url: url,
				});
			}

			await msg.delete().catch(() => { });
			await i.editReply({
				content: "<:Tick:1375519268292264012> Author URL updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: i.message.components,
			});
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Author URL update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleTitleOption(i: any) {
		const modal = new ModalBuilder()
			.setCustomId("title_modal")
			.setTitle("Set Embed Title")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("title")
						.setLabel("Title")
						.setStyle(TextInputStyle.Short)
						.setPlaceholder("Enter your title here")
						.setRequired(true)
						.setValue(this.embed.data.title || "")
						.setMaxLength(256),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("url")
						.setLabel("URL (Optional)")
						.setStyle(TextInputStyle.Short)
						.setPlaceholder("https://example.com")
						.setRequired(false)
						.setValue(this.embed.data.url || ""),
				),
			);

		await i.showModal(modal);

		try {
			const submission = await i.awaitModalSubmit({
				time: 120000,
				filter: (i: any) => i.customId === "title_modal",
			});

			const title = submission.fields.getTextInputValue("title");
			const url = submission.fields.getTextInputValue("url");

			this.embed.setTitle(title);

			if (url) {
				try {
					new URL(url);
					this.embed.setURL(url);
				} catch (error) {
					await submission.reply({
						content: "⚠️ Invalid URL format. Title was updated but URL was ignored.",
						flags: MessageFlags.Ephemeral,
					});

					// Still update with title but no URL
					await this.message?.edit({
						embeds: [this.embed, this.createInstructionEmbed()],
						components: [this.createMainMenu(), this.createActionButtons()],
					});
					return;
				}
			} else {
				// If URL was previously set but now empty, remove it
				if (this.embed.data.url) {
					this.embed.setURL(null);
				}
			}

			await submission.reply({
				content: "<:Tick:1375519268292264012> Title updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
			});
		} catch (error) {
			// Modal timed out
		}
	}

	private async handleDescriptionOption(i: any, ctx: Context) {
		const modal = new ModalBuilder()
			.setCustomId("description_modal")
			.setTitle("Set Embed Description")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("description")
						.setLabel("Description")
						.setStyle(TextInputStyle.Paragraph)
						.setPlaceholder("Enter your description here")
						.setRequired(true)
						.setValue(this.embed.data.description || "")
						.setMaxLength(4000),
				),
			);

		await i.showModal(modal);

		try {
			const submission = await i.awaitModalSubmit({
				time: 120000,
				filter: (i: any) => i.customId === "description_modal",
			});

			const description = submission.fields.getTextInputValue("description");

			this.embed.setDescription(description);

			await submission.reply({
				content: "<:Tick:1375519268292264012> Description updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
			});
		} catch (error) {
			// Modal timed out
		}
	}

	private async handleColorOption(i: any, ctx: Context) {
		const colorRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("color_red").setLabel("Red").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("color_blue").setLabel("Blue").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("color_green").setLabel("Green").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("color_yellow").setLabel("Yellow").setStyle(ButtonStyle.Secondary).setEmoji("🟡"),
			new ButtonBuilder().setCustomId("color_purple").setLabel("Purple").setStyle(ButtonStyle.Secondary).setEmoji("🟣"),
		);

		const colorRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("color_custom").setLabel("Custom Color").setStyle(ButtonStyle.Secondary).setEmoji("🎨"),
			this.createBackButton(),
		);

		const colorGuide = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("Color Selection")
			.setDescription("Choose a preset color or enter a custom color.")
			.addFields({ name: "🎨 Custom Colors", value: 'For custom colors, you can enter:\n• A color name (e.g., "gold", "navy")\n• A hex code (e.g., "#FF5500")' });

		await i.update({
			embeds: [this.embed, colorGuide],
			components: [colorRow, colorRow2],
		});
	}

	private async handleCustomColor(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter a color name (like 'gold') or hex code (like '#FF5500'):",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg || !msg.content.trim()) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No color provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const colorInput = msg.content.trim();

			// Try to resolve the color
			let validColor: string | null = null;

			// Check if it's a hex code
			if (/^#?[0-9A-F]{6}$/i.test(colorInput.replace("#", ""))) {
				validColor = colorInput.startsWith("#") ? colorInput : `#${colorInput}`;
			}
			// Check if it's a color name in the colors object
			else {
				const lowerInput = colorInput.toLowerCase();
				if (Object.hasOwn(colors, lowerInput)) {
					validColor = colors[lowerInput as keyof typeof colors];
				}
			}

			if (!validColor) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid color. Please provide a valid color name or hex code.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			this.embed.setColor(validColor as ColorResolvable);

			await msg.delete().catch(() => { });
			await i.editReply({
				content: `<:Tick:1375519268292264012> Color updated to ${colorInput}!`,
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: i.message.components,
			});
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Color selection timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleFieldsOption(i: any) {
		const modal = new ModalBuilder()
			.setCustomId("fields_modal")
			.setTitle("Add Embed Field")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("field_name").setLabel("Field Name").setStyle(TextInputStyle.Short).setPlaceholder("Enter field name").setRequired(true).setMaxLength(256),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("field_value").setLabel("Field Value").setStyle(TextInputStyle.Paragraph).setPlaceholder("Enter field value").setRequired(true).setMaxLength(1024),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("field_inline").setLabel("Inline? (true/false)").setStyle(TextInputStyle.Short).setPlaceholder("true or false").setValue("true").setRequired(false),
				),
			);

		await i.showModal(modal);

		try {
			const submission = await i.awaitModalSubmit({
				time: 120000,
				filter: (i: any) => i.customId === "fields_modal",
			});

			const name = submission.fields.getTextInputValue("field_name");
			const value = submission.fields.getTextInputValue("field_value");
			const inlineInput = submission.fields.getTextInputValue("field_inline").toLowerCase();
			const inline = inlineInput !== "false"; // Default to true unless explicitly set to "false"

			this.embed.addFields({ name, value, inline });

			await submission.reply({
				content: "<:Tick:1375519268292264012> Field added successfully!",
				flags: MessageFlags.Ephemeral,
			});

			// If we have more than 25 fields (Discord limit), remove the oldest one
			if (this.embed.data.fields && this.embed.data.fields.length > 25) {
				this.embed.data.fields.shift();
			}

			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
			});
		} catch (error) {
			// Modal timed out
		}
	}

	private async handleThumbnailOption(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the thumbnail URL or upload an image:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg) return;

			let thumbnailUrl = msg.content.trim();
			if (!thumbnailUrl && msg.attachments.size > 0) {
				thumbnailUrl = msg.attachments.first()?.url || "";
			}

			if (!thumbnailUrl) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid URL or image provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			try {
				new URL(thumbnailUrl);
			} catch (error) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid URL format. Please provide a valid URL.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			this.embed.setThumbnail(thumbnailUrl);


			await i.editReply({
				content: "<:Tick:1375519268292264012> Thumbnail updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
			});
			await msg.delete().catch(() => { });
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Thumbnail update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleImageOption(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the image URL or upload an image:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg) return;

			let imageUrl = msg.content.trim();
			if (!imageUrl && msg.attachments.size > 0) {
				imageUrl = msg.attachments.first()?.url || "";
			}

			if (!imageUrl) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid URL or image provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			try {
				new URL(imageUrl);
			} catch (error) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid URL format. Please provide a valid URL.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			this.embed.setImage(imageUrl);


			await i.editReply({
				content: "<:Tick:1375519268292264012> Image updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
			});
			await msg.delete().catch(() => { });
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Image update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
	}

	private async handleFooterOption(i: any, ctx: Context) {
		const footerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("footer_name").setLabel("Set Text").setEmoji("✏️").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("footer_icon").setLabel("Set Icon").setEmoji("🖼️").setStyle(ButtonStyle.Primary).setDisabled(!this.embed.data.footer?.text),
			this.createBackButton(),
		);

		const guideEmbed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("Footer Settings")
			.setDescription("Customize the footer section of your embed.")
			.addFields(
				{ name: "📝 Instructions", value: "1. First set the footer text (required)\n2. Then optionally add an icon" },
				{ name: "💡 Tips", value: "• Footer text appears at the bottom of your embed\n• Icon appears as a small image next to the footer text" },
			);

		await i.update({
			embeds: [this.embed, guideEmbed],
			components: [footerRow],
		});
	}

	private async handleFooterName(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the footer text:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg || !msg.content.trim()) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid text provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const footerText = msg.content.trim();

			// Update the footer text (preserving existing icon if present)
			const currentFooter = this.embed.data.footer;
			this.embed.setFooter({
				text: footerText,
				iconURL: currentFooter?.icon_url,
			});

			// Enable the footer icon button
			const components = i.message.components;
			const footerRow = components[0];

			const updatedComponents = footerRow.components.map((component: any) => {
				if (component.customId === "footer_icon") {
					return new ButtonBuilder()
						.setCustomId(component.customId)
						.setLabel(component.label)
						.setStyle(component.style)
						.setDisabled(false);
				}
				return component;
			});


			await msg.delete().catch(() => { });
			await i.editReply({
				content: "<:Tick:1375519268292264012> Footer text updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: [
					new ActionRowBuilder().addComponents(updatedComponents),
					...components.slice(1)
				]
			});
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Footer text update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleFooterIcon(i: any, ctx: Context) {
		await i.reply({
			content: "Please enter the footer icon URL or upload an image:",
			flags: MessageFlags.Ephemeral,
		});

		const channel = i.channel as TextChannel;
		try {
			const collected = await channel.awaitMessages({
				filter: (m) => m.author.id === i.user.id,
				max: 1,
				time: 60000,
				errors: ["time"],
			});

			const msg = collected.first();
			if (!msg) return;

			let iconUrl = msg.content.trim();
			if (!iconUrl && msg.attachments.size > 0) {
				iconUrl = msg.attachments.first()?.url || "";
			}

			if (!iconUrl) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> No valid URL or image provided. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			try {
				new URL(iconUrl);
			} catch (error) {
				await i.followUp({
					content: "<:Cross:1375519752746958858> Invalid URL format. Please provide a valid URL.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const currentFooter = this.embed.data.footer;
			if (currentFooter) {
				this.embed.setFooter({
					text: currentFooter.text,
					iconURL: iconUrl,
				});
			}


			await i.editReply({
				content: "<:Tick:1375519268292264012> Footer icon updated successfully!",
				flags: MessageFlags.Ephemeral,
			});

			await this.message?.edit({
				embeds: [this.embed, i.message.embeds[1]],
				components: i.message.components,
			});
			await msg.delete().catch(() => { });
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Footer icon update timed out. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
	private async handleTimestampOption(i: any) {
		// Toggle timestamp between current time and none
		if (this.embed.data.timestamp) {
			// Remove timestamp if it exists
			this.embed.setTimestamp(null);
			await i.reply({
				content: "<:Tick:1375519268292264012> Timestamp removed!",
				flags: MessageFlags.Ephemeral,
			});
		} else {
			// Add current timestamp
			this.embed.setTimestamp();
			await i.reply({
				content: "<:Tick:1375519268292264012> Current timestamp added!",
				flags: MessageFlags.Ephemeral,
			});
		}

		await this.updateMessage(i);
	}

	private async handlePreviewEmbed(i: any) {
		// Just refresh the current view to show the embed preview
		await i.reply({
			content: "📊 Here's a preview of your embed:",
			embeds: [this.embed],
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleResetEmbed(i: any) {
		// Reset the embed to default state
		this.embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setDescription("Your embed will appear here. Use the menu below to customize it.");

		await i.reply({
			content: "🔄 Embed has been reset to default!",
			flags: MessageFlags.Ephemeral,
		});

		await this.updateMessage(i);
	}

	private async handleSendEmbed(i: any, ctx: Context) {
		// Create a channel selector
		const channelSelector = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
			new ChannelSelectMenuBuilder()
				.setCustomId("channel_select")
				.setPlaceholder("Select a channel to send the embed")
				.setChannelTypes(ChannelType.GuildText)
		);

		const backButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(this.createBackButton());

		await i.update({
			content: "📤 Select a channel to send your embed:",
			embeds: [this.embed],
			components: [channelSelector, backButtonRow],
		});

		try {
			const channelResponse = await this.message?.awaitMessageComponent({
				filter: (i) => i.user.id === ctx.author?.id && i.customId === "channel_select",
				componentType: ComponentType.ChannelSelect,
				time: 60000,
			});

			if (!channelResponse) return;

			const selectedChannelId = channelResponse.values[0];
			const selectedChannel = channelResponse.guild?.channels.cache.get(selectedChannelId!) as TextChannel;

			if (!selectedChannel || !selectedChannel.isTextBased()) {
				await channelResponse.reply({
					content: "<:Cross:1375519752746958858> Invalid channel selection. Please try again.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Send the embed to the selected channel
			await selectedChannel.send({ embeds: [this.embed] });

			await channelResponse.reply({
				content: `<:Tick:1375519268292264012> Embed sent successfully to ${selectedChannel}!`,
				flags: MessageFlags.Ephemeral,
			});

			// Return to main menu
			await this.message?.edit({
				embeds: [this.embed, this.createInstructionEmbed()],
				components: [this.createMainMenu(), this.createActionButtons()],
				content: null,
			});
		} catch (error) {
			await i.followUp({
				content: "<:Cross:1375519752746958858> Channel selection timed out or encountered an error. Please try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async updateMessage(i: any) {
		// Helper function to update the message with current embed state
		await this.message?.edit({
			embeds: [this.embed, this.createInstructionEmbed()],
			components: [this.createMainMenu(), this.createActionButtons()],
		});
	}
}