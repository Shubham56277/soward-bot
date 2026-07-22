import {
	ActionRowBuilder,
	APIEmbed,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	EmbedBuilder,
	Message,
	MessageFlags,
	ModalBuilder,
	TextChannel,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Welcome } from "@repo/db";
import { replacePlaceholders } from "../../utils/helper";
import { createWelcomeImage } from "../../utils/canvas";

export default class WelcomeCommand extends Command {
	private collectors: Set<any> = new Set();

	constructor() {
		super({
			name: "welcome",
			description: {
				content: "Configure the welcome message for your server.",
				examples: ["welcome", "wlc"],
				usage: "welcome",
			},
			category: "welcome",
			aliases: ["wlc"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [],
		});
	}

	private cleanupCollectors() {
		for (const collector of this.collectors) {
			if (!collector.ended) {
				collector.stop();
			}
		}
		this.collectors.clear();
	}

	private createChannelSelectionEmbed(baseEmbed: EmbedBuilder): EmbedBuilder {
		return baseEmbed.setDescription(
			"### Welcome Configuration\n" +
			"Please select a channel where welcome messages will be sent\n\n" +
			"🔹 This channel will receive notifications when new members join\n" +
			"🔹 Make sure the bot has permissions in that channel",
		);
	}

	private createChannelSelectRow(): ActionRowBuilder<ChannelSelectMenuBuilder> {
		const menuChannel = new ChannelSelectMenuBuilder()
			.setCustomId("welcome_channel_menu")
			.setPlaceholder("Select a channel")
			.setMinValues(1)
			.setMaxValues(1);

		return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menuChannel);
	}

	private getVariablesText(): string {
		return "**Available Variables:**\n" +
			"`{server}` - Server name\n" +
			"`{user}` - User's name\n" +
			"`{servericon}` - Server icon URL\n" +
			"`{membercount}` - Total member count\n" +
			"`{tag}` - User tag\n" +
			"`{username}` - Username\n" +
			"`{mention}` - User mention\n" +
			"`{avatar}` - User avatar URL";
	}

	private async handlePreview(interaction: ButtonInteraction, ctx: Context): Promise<void> {
		const welcome = await Welcome.get(ctx.guild!.id);

		if (!welcome || !welcome.enabled) {
			await interaction.reply({
				content: "<:Cross:1375519752746958858> **Welcome system is not configured or disabled**\n\nPlease configure the welcome system first.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			if (welcome.type === "card") {
				const cardMessage = replacePlaceholders(welcome.message || "hey {mention} welcome to the {server}", ctx.member!, ctx.guild!);
				const cardBuffer = await createWelcomeImage(ctx.member!, ctx.guild!);
				const attachment = new AttachmentBuilder(cardBuffer, { name: "welcome.png" });

				await interaction.reply({
					content: cardMessage,
					files: [attachment],
					flags: MessageFlags.Ephemeral,
				});
			} else if (welcome.type === "embed-text") {
				if (welcome.embed) {
					const embedData = welcome.embed;
					const processedEmbed: APIEmbed = embedData as APIEmbed;

					if (processedEmbed.title) {
						processedEmbed.title = replacePlaceholders(processedEmbed.title, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.description) {
						processedEmbed.description = replacePlaceholders(processedEmbed.description, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.footer?.text) {
						processedEmbed.footer.text = replacePlaceholders(processedEmbed.footer.text, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.footer?.icon_url) {
						processedEmbed.footer.icon_url = replacePlaceholders(processedEmbed.footer.icon_url, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.thumbnail?.url) {
						processedEmbed.thumbnail.url = replacePlaceholders(processedEmbed.thumbnail.url, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.image?.url) {
						processedEmbed.image.url = replacePlaceholders(processedEmbed.image.url, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.author?.name) {
						processedEmbed.author.name = replacePlaceholders(processedEmbed.author.name, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.author?.icon_url) {
						processedEmbed.author.icon_url = replacePlaceholders(processedEmbed.author.icon_url, ctx.member!, ctx.guild!);
					}
					if (processedEmbed.fields) {
						for (const field of processedEmbed.fields) {
							field.value = replacePlaceholders(field.value, ctx.member!, ctx.guild!);
						}
					}
					if (processedEmbed.timestamp) {
						processedEmbed.timestamp = new Date().toISOString();
					}
					const previewEmbed = new EmbedBuilder(processedEmbed);

					await interaction.reply({
						content: "### 🎉 Welcome Message Preview (Embed Type)",
						embeds: [previewEmbed],
						flags: MessageFlags.Ephemeral,
					});
				} else if (welcome.message) {
					const processedMessage = replacePlaceholders(welcome.message, ctx.member!, ctx.guild!);

					await interaction.reply({
						content: `### 🎉 Welcome Message Preview (Text Type)\n\n${processedMessage}`,
						flags: MessageFlags.Ephemeral,
					});
				}
			}
		} catch (error) {
			console.error("Preview error:", error);
			await interaction.reply({
				content: "<:Cross:1375519752746958858> **Failed to generate preview**\n\nThere might be an issue with your welcome configuration.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	private async handleToggle(interaction: ButtonInteraction, ctx: Context): Promise<void> {
		const welcome = await Welcome.get(ctx.guild!.id);

		if (!welcome) {
			await interaction.reply({
				content: "<:Cross:1375519752746958858> **Welcome system is not configured**\n\nPlease configure the welcome system first.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const updatedWelcome = await Welcome.update(ctx.guild!.id, {
			enabled: !welcome.enabled,
		});

		const status = updatedWelcome?.enabled ? "<:Tick:1375519268292264012> Enabled" : "<:Cross:1375519752746958858> Disabled";

		await interaction.reply({
			content: `### 🔄 Welcome System Toggled\n**Status:** ${status}`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleReset(interaction: ButtonInteraction, ctx: Context): Promise<void> {
		const confirmButton = new ButtonBuilder()
			.setCustomId("confirm_welcome_reset")
			.setLabel("Confirm")
			.setStyle(ButtonStyle.Danger);

		await interaction.reply({
			content: "<:Cross:1375519752746958858> **Are you sure you want to reset the welcome system?**\n\nThis action cannot be undone.",
			components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton)],
			flags: MessageFlags.Ephemeral,
		}).then((message) => {
			const collector = message.createMessageComponentCollector({ time: 15000 });
			collector.on("collect", async (i) => {
				if (i.customId === "confirm_welcome_reset") {
					await Welcome.delete(ctx.guild!.id);
					await i.reply({
						content: "<:Tick:1375519268292264012> **Welcome system has been reset**",
						flags: MessageFlags.Ephemeral,
					});
					setTimeout(async () => {
						try {
							const baseEmbed = new EmbedBuilder()
								.setTitle("✨ Welcome Message Setup")
								.setDescription("Customize how new members are greeted")
								.setColor(ctx.client.config.colors.main)

							const channelSelectEmbed = this.createChannelSelectionEmbed(baseEmbed);
							const channelRow = this.createChannelSelectRow();

							await interaction.editReply({
								content: null,
								embeds: [channelSelectEmbed],
								components: [channelRow],
							});
						} catch (error) {
							console.error("Error refreshing after reset:", error);
						}
					}, 2000);
				}
			});
		})
		
	}

	private async handleSetMessage(interaction: ButtonInteraction, ctx: Context): Promise<void> {
		const welcome = await Welcome.get(ctx.guild!.id);

		if (!welcome) {
			await interaction.reply({
				content: "<:Cross:1375519752746958858> **Welcome system is not configured**\n\nPlease configure the welcome system first.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId("set_welcome_message_modal")
			.setTitle("Set Welcome Message");

		const messageInput = new TextInputBuilder()
			.setCustomId("welcome_message_input")
			.setPlaceholder("Welcome {mention} to {server}! We're glad to have you here.")
			.setLabel("Welcome Message")
			.setValue(welcome.message || "")
			.setMinLength(1)
			.setMaxLength(2000)
			.setStyle(TextInputStyle.Paragraph);

		const row = new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput);
		modal.addComponents(row);

		try {
			await interaction.showModal(modal);

			const filter = (modalInteraction: any) => modalInteraction.user.id === ctx.author?.id;
			const modalSubmit = await interaction.awaitModalSubmit({
				filter,
				time: 120000,
			});

			if (modalSubmit.customId === "set_welcome_message_modal") {
				const messageText = modalSubmit.fields.getTextInputValue("welcome_message_input");

				await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

				const updatedWelcome = await Welcome.update(ctx.guild!.id, {
					message: messageText,
				});

				await modalSubmit.editReply({
					content: `### ✅ Message Updated Successfully\n**New Message:** ${messageText}\n**Channel:** <#${updatedWelcome?.channelId}>\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`,
				});
			}
		} catch (error) {
			console.error("Set message error:", error);
		}
	}

	private async handleCardWelcome(interaction: ButtonInteraction, ctx: Context, baseEmbed: EmbedBuilder): Promise<void> {
		try {
			const welcome = await Welcome.update(ctx.guild!.id, {
				type: "card",
			});

			const variablesText = this.getVariablesText();

			const embed = new EmbedBuilder()
				.setColor(ctx.client.config.colors.main)
				.setDescription(
					`### Welcome Card Setup\nWelcome message will be sent in <#${welcome?.channelId}>\nA welcome card will be generated with the user's avatar\n\n**Please set a message to display on the card:**\n\`Example: hey {mention} welcome to the {server}\`\n\n${variablesText}`,
				);

			await interaction.update({
				embeds: [embed],
				components: [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder().setCustomId("welcome_message").setLabel("Set Message").setEmoji("📝").setStyle(ButtonStyle.Primary),
						new ButtonBuilder().setCustomId("welcome_skip").setLabel("Use Default").setEmoji("➡️").setStyle(ButtonStyle.Secondary),
					),
				],
			});

			const message = await interaction.fetchReply();
			await this.handleCardMessageSetup(message, ctx, welcome);
		} catch (error) {
			console.error("Card welcome setup error:", error);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "<:Cross:1375519752746958858> **Setup failed**\n\nPlease try again.",
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	}

	private async handleEmbedMessageWelcome(interaction: ButtonInteraction, ctx: Context, baseEmbed: EmbedBuilder): Promise<void> {
		try {
			const welcome = await Welcome.update(ctx.guild!.id, {
				type: "embed-text",
			});

			const variablesText = this.getVariablesText();

			const embed = new EmbedBuilder()
				.setColor(ctx.client.config.colors.main)
				.setDescription(
					`### Embed + Message Setup\nWelcome message will be sent in <#${welcome?.channelId}>\n\n**You can send either:**\n🔹 **Upload JSON File** - Upload a .json file with embed data\n🔹 **Text Message** - Simple text message\n\n${variablesText}\n\n✨ **Need help making Embed JSON?** Try it here: [embed.appujet.site](https://embed.appujet.site)\n\n**Example Embed JSON:**\n\`\`\`json\n{\n  "title": "Welcome to {server}!",\n  "description": "Hey {mention}, welcome to our server!",\n  "color": 5814783,\n  "thumbnail": {\n    "url": "{avatar}"\n  }\n}\n\`\`\``
				);

			await interaction.update({
				embeds: [embed],
				components: [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder().setCustomId("welcome_upload_json").setLabel("Upload JSON File").setEmoji("📁").setStyle(ButtonStyle.Primary),
						new ButtonBuilder().setCustomId("welcome_text_message").setLabel("Set Text Message").setEmoji("📝").setStyle(ButtonStyle.Secondary),
						new ButtonBuilder().setCustomId("welcome_skip_embed").setLabel("Use Default").setEmoji("➡️").setStyle(ButtonStyle.Secondary),
					),
				],
			});

			const message = await interaction.fetchReply();
			await this.handleEmbedMessageSetup(message, ctx, welcome);
		} catch (error) {
			console.error("Embed message setup error:", error);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "<:Cross:1375519752746958858> **Setup failed**\n\nPlease try again.",
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	}

	private async handleEmbedMessageSetup(message: Message, ctx: Context, welcome: any): Promise<void> {
		const filter = (interaction: any) => interaction.user.id === ctx.author?.id;

		const collector = message.createMessageComponentCollector({
			filter,
			time: 120000,
		});

		this.collectors.add(collector);

		collector.on("collect", async (init) => {
			try {
				if (init.customId === "welcome_upload_json") {
					await init.reply({
						content: "📁 **Upload your JSON file**\n\nPlease upload a `.json` file containing your embed configuration in the next message.\n\n⚠️ **Important:** Make sure the file contains valid JSON format.",
						flags: MessageFlags.Ephemeral,
					});

					// Create a message collector to wait for file upload
					const messageFilter = (msg: Message) => {
						return msg.author.id === ctx.author?.id &&
							msg.attachments.size > 0 &&
							msg.attachments.some(att => att.name?.endsWith('.json'));
					};

					const messageCollector = (message.channel as TextChannel).createMessageCollector({
						filter: messageFilter,
						time: 60000, // 1 minute to upload
						max: 1
					});

					messageCollector.on('collect', async (msg) => {
						try {
							const jsonAttachment = msg.attachments.find(att => att.name?.endsWith('.json'));
							if (!jsonAttachment) return;

							// Fetch the file content
							const response = await fetch(jsonAttachment.url);
							const jsonContent = await response.text();

							try {
								const jsonData = JSON.parse(jsonContent);

								// Handle both direct embed object and embeds array format
								let embedJson: any;
								if (jsonData.embeds && Array.isArray(jsonData.embeds) && jsonData.embeds.length > 0) {
									// If it's an embeds array, take the first embed
									embedJson = jsonData.embeds[0];
								} else if (jsonData.title || jsonData.description || jsonData.color) {
									// If it's already a direct embed object
									embedJson = jsonData;
								} else {
									throw new Error("Invalid embed format - must contain embed data or embeds array");
								}

								// Validate that the embed has at least a title or description
								if (!embedJson.title && !embedJson.description) {
									throw new Error("Embed must have at least a title or description");
								}

								// Update welcome with the JSON data
								const updatedWelcome = await Welcome.update(ctx.guild!.id, {
									embed: embedJson,
									enabled: true
								});

								const embed = new EmbedBuilder()
									.setColor(ctx.client.config.colors.main)
									.setTitle("<:Tick:1375519268292264012> JSON File Uploaded Successfully")
									.setDescription(
										`### Welcome Embed Configured\n**Channel:** <#${updatedWelcome?.channelId}>\n**Type:** ${this.formatWelcomeType(updatedWelcome?.type!)}\n**Format:** Uploaded JSON File\n**File:** ${jsonAttachment.name}\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`
									);

								const managementRow = this.createManagementRow();

								await message.edit({
									embeds: [embed],
									components: [managementRow],
								});

								// Delete the user's message with the file
								try {
									await msg.delete();
								} catch (error) {
									// Ignore if we can't delete the message
								}

							} catch (parseError) {
								await msg.reply({
									// biome-ignore lint/style/useTemplate: <explanation>
									content: "<:Cross:1375519752746958858> **Invalid JSON Format**\n\nThe uploaded file contains invalid JSON. Please check your JSON syntax and try again.\n\n**Error:** ```" + parseError + "```",
								});
							}
						} catch (error) {
							console.error("File processing error:", error);
							await msg.reply({
								content: "<:Cross:1375519752746958858> **Failed to process file**\n\nCouldn't read the uploaded JSON file. Please try again.",
							});
						}
					});

					messageCollector.on('end', (collected) => {
						if (collected.size === 0) {
							// Send a follow-up message if no file was uploaded
							init.followUp({
								content: "⏰ **Time expired** - No JSON file was uploaded. Please try again if needed.",
								flags: MessageFlags.Ephemeral,
							}).catch(() => { });
						}
					});

				} else if (init.customId === "welcome_text_message") {
					const modal = new ModalBuilder().setCustomId("welcome_text_message_modal").setTitle("Welcome Text Message");

					const textInput = new TextInputBuilder()
						.setCustomId("welcome_text_message_input")
						.setPlaceholder("Welcome {mention} to {server}! We're glad to have you here.")
						.setLabel("Welcome Message Text")
						.setValue(welcome?.message || "Welcome {mention} to {server}!")
						.setMinLength(1)
						.setMaxLength(2000)
						.setStyle(TextInputStyle.Paragraph);

					const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
					modal.addComponents(row);
					await init.showModal(modal);

					const modalSubmit = await init.awaitModalSubmit({
						filter,
						time: 120000,
					});

					if (modalSubmit.customId === "welcome_text_message_modal") {
						await modalSubmit.deferUpdate();
						const messageText = modalSubmit.fields.getTextInputValue("welcome_text_message_input");
						const updatedWelcome = await Welcome.update(ctx.guild!.id, {
							message: messageText,
							enabled: true
						});

						const embed = new EmbedBuilder()
							.setColor(ctx.client.config.colors.main)
							.setTitle("<:Tick:1375519268292264012> Text Message Setup Complete")
							.setDescription(
								`### Welcome Message Configured\n**Channel:** <#${updatedWelcome?.channelId}>\n**Type:** ${this.formatWelcomeType(updatedWelcome?.type!)}\n**Format:** Text Message\n**Message:** ${updatedWelcome?.message}\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`,
							);

						const managementRow = this.createManagementRow();

						await modalSubmit.editReply({
							embeds: [embed],
							components: [managementRow],
						});
					}
				} else if (init.customId === "welcome_skip_embed") {
					const defaultEmbedJson = {
						title: "Welcome to {server}!",
						description: "Hey {mention}, welcome to our server! 🎉",
						color: 5814783,
						thumbnail: {
							url: "{avatar}"
						},
						footer: {
							text: "Member #{membercount}"
						},
						timestamp: new Date().toISOString()
					};

					const updatedWelcome = await Welcome.update(ctx.guild!.id, {
						embed: defaultEmbedJson,
						enabled: true,
					});

					const embed = new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setTitle("<:Tick:1375519268292264012> Default Embed Setup Complete")
						.setDescription(
							`### Welcome Embed Configured\n**Channel:** <#${updatedWelcome?.channelId}>\n**Type:** ${this.formatWelcomeType(updatedWelcome?.type!)}\n**Format:** Default Embed JSON\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`,
						);

					const managementRow = this.createManagementRow();

					await init.update({
						embeds: [embed],
						components: [managementRow],
					});
				}
			} catch (error) {
				console.error("Embed message setup error:", error);
			}
		});

		collector.on("end", () => {
			this.collectors.delete(collector);
		});
	}
	private createConfigMenuEmbed(baseEmbed: EmbedBuilder, welcome: any): EmbedBuilder {
		const status = welcome?.enabled ? "<:Tick:1375519268292264012> Enabled" : "<:Cross:1375519752746958858> Disabled";
		const type = this.formatWelcomeType(welcome?.type);
		const channel = welcome?.channelId ? `<#${welcome.channelId}>` : "Not set";

		return baseEmbed.setDescription(
			`### Welcome Configuration\nCustomize how new members are greeted in your server\n\n**Status:** ${status}\n**Type:** ${type}\n**Channel:** ${channel}\n\nSelect an option below to configure your welcome message`,
		);
	}

	private formatWelcomeType(type: string): string {
		switch (type) {
			case "card":
				return "📷 Welcome Card";
			case "embed-text":
				return "✨ Embed / Message";
			default:
				return "Not set";
		}
	}

	private async handleCardMessageSetup(message: Message, ctx: Context, welcome: any): Promise<void> {
		const filter = (interaction: any) => interaction.user.id === ctx.author?.id;

		const collector = message.createMessageComponentCollector({
			filter,
			time: 120000,
		});

		this.collectors.add(collector);

		collector.on("collect", async (init) => {
			try {
				if (init.customId === "welcome_message") {
					const modal = new ModalBuilder().setCustomId("welcome_message_modal").setTitle("Welcome Message");

					const Input = new TextInputBuilder()
						.setCustomId("welcome_message_input")
						.setPlaceholder("Type your welcome message")
						.setLabel("Welcome Message")
						.setValue(welcome?.message || "hey {mention} welcome to the {server}")
						.setMinLength(1)
						.setMaxLength(500)
						.setStyle(TextInputStyle.Paragraph);

					const row = new ActionRowBuilder<TextInputBuilder>().addComponents(Input);

					modal.addComponents(row);
					await init.showModal(modal);

					const modalSubmit = await init.awaitModalSubmit({
						filter,
						time: 120000,
					});

					if (modalSubmit.customId === "welcome_message_modal") {
						const messageText = modalSubmit.fields.getTextInputValue("welcome_message_input");
						await modalSubmit.deferUpdate();
						const updatedWelcome = await Welcome.update(ctx.guild!.id, { message: messageText, enabled: true });

						const embed = new EmbedBuilder()
							.setColor(ctx.client.config.colors.main)
							.setTitle("<:Tick:1375519268292264012> Setup Complete")
							.setDescription(
								`### Welcome Message Configured\n**Channel:** <#${updatedWelcome?.channelId}>\n**Type:** ${this.formatWelcomeType(updatedWelcome?.type!)}\n**Message:** ${updatedWelcome?.message}\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`,
							);

						const managementRow = this.createManagementRow();

						await modalSubmit.editReply({
							embeds: [embed],
							components: [managementRow],
						});
					}
				} else if (init.customId === "welcome_skip") {
					const updatedWelcome = await Welcome.update(ctx.guild!.id, {
						message: welcome?.message || "hey {mention} welcome to the {server}",
						enabled: true,
					});

					const embed = new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setTitle("<:Tick:1375519268292264012> Setup Complete")
						.setDescription(
							`### Welcome Message Configured\n**Channel:** <#${updatedWelcome?.channelId}>\n**Type:** ${this.formatWelcomeType(updatedWelcome?.type!)}\n**Message:** ${updatedWelcome?.message}\n**Status:** ${updatedWelcome?.enabled ? "Enabled" : "Disabled"}`,
						);

					const managementRow = this.createManagementRow();

					await init.update({
						embeds: [embed],
						components: [managementRow],
					});
				}
			} catch (error) {
				console.error("Card message setup error:", error);
			}
		});

		collector.on("end", () => {
			this.collectors.delete(collector);
		});
	}

	private createManagementRow(): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("toggle_welcome").setLabel("Toggle").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId("preview_welcome").setLabel("Preview").setEmoji("👁️").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("set_message").setLabel("Set Message").setEmoji("📝").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("reset_welcome").setLabel("Reset").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("home").setLabel("Home").setEmoji("🏠").setStyle(ButtonStyle.Secondary),
		);
	}

	private createMainButtonRow(): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("welcome_type_card").setLabel("Welcome Card").setEmoji("📷").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId("welcome_type_embed_message").setLabel("Embed + Message").setEmoji("✨").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("preview_welcome").setLabel("Preview").setEmoji("👁️").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("reset_welcome").setLabel("Reset").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
		);
	}

	public async run(ctx: Context): Promise<any> {
		this.cleanupCollectors();

		const mainColor = ctx.client.config.colors.main;
		const welcome = await Welcome.get(ctx.guild!.id);
		let setupMsg: Message | undefined;

		const baseEmbed = new EmbedBuilder()
			.setTitle("✨ Welcome Message Setup")
			.setColor(mainColor)
			.setFooter({ text: "Customize how new members are greeted" });

		const filter = (interaction: any) => {
			if (interaction.user.id === ctx.author?.id) return true;
			interaction.reply({
				content: "<:Cross:1375519752746958858> You are not allowed to interact with this message",
				flags: MessageFlags.Ephemeral,
			}).catch(() => { });
			return false;
		};

		if (!welcome) {
			const channelSelectEmbed = this.createChannelSelectionEmbed(baseEmbed);
			const channelRow = this.createChannelSelectRow();

			setupMsg = await ctx.editOrReply({
				embeds: [channelSelectEmbed],
				components: [channelRow],
			});
		} else {
			const configEmbed = this.createConfigMenuEmbed(baseEmbed, welcome);
			const buttonRow = this.createMainButtonRow();

			setupMsg = await ctx.editOrReply({
				embeds: [configEmbed],
				components: [buttonRow],
			});
		}

		const collector = setupMsg.createMessageComponentCollector({
			filter,
			time: 300000, // 5 minutes
		});

		this.collectors.add(collector);

		collector.on("collect", async (interaction) => {
			try {
				const { customId } = interaction;

				if (customId === "welcome_channel_menu") {
					if (!interaction.isChannelSelectMenu()) return;

					const channelId = interaction.values[0];
					await Welcome.update(ctx.guild!.id, { channelId });
					await interaction.update({
						embeds: [this.createConfigMenuEmbed(baseEmbed, { channelId })],
						components: [this.createMainButtonRow()],
					});
				}

				if (customId === "welcome_type_card") {
					await this.handleCardWelcome(interaction as ButtonInteraction, ctx, baseEmbed);
				}

				if (customId === "welcome_type_embed_message") {
					await this.handleEmbedMessageWelcome(interaction as ButtonInteraction, ctx, baseEmbed);
				}

				if (customId === "preview_welcome") {
					await this.handlePreview(interaction as ButtonInteraction, ctx);
				}

				if (customId === "toggle_welcome") {
					await this.handleToggle(interaction as ButtonInteraction, ctx);
				}

				if (customId === "reset_welcome") {
					await this.handleReset(interaction as ButtonInteraction, ctx);
				}

				if (customId === "set_message") {
					await this.handleSetMessage(interaction as ButtonInteraction, ctx);
				}

				if (customId === "home") {
					const currentWelcome = await Welcome.get(ctx.guild!.id);
					const configEmbed = this.createConfigMenuEmbed(baseEmbed, currentWelcome);
					const buttonRow = this.createMainButtonRow();

					await interaction.update({
						embeds: [configEmbed],
						components: [buttonRow],
					});
				}
			} catch (error) {
				console.error("Welcome setup error:", error);
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: "<:Cross:1375519752746958858> Something went wrong, please try again later.",
						flags: MessageFlags.Ephemeral,
					});
				}
			}
		});

		collector.on("end", () => {
			setupMsg?.edit({
				components: [],
			});
		});
	}
}