import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	ColorResolvable,
	ComponentType,
	ContainerBuilder,
	EmbedBuilder,
	MessageFlags,
	ModalBuilder,
	RoleSelectMenuBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextChannel,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	parseEmoji,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { TicketConfig } from "@repo/db";

export default class TicketCommand extends Command {
	private setupSessions = new Map();
	constructor() {
		super({
			name: "ticket",
			description: {
				content: "Create and manage ticket systems.",
				examples: ["ticket create", "ticket edit", "ticket delete", "ticket info", "ticket list"],
				usage: "ticket [create|edit|delete|info|list]",
			},
			category: "ticket",
			aliases: ["tickets", "support"],
			cooldown: 5,
			args: true,
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
			options: [
				{
					name: "create",
					description: "Create a new ticket system",
					type: 1,
				},
				{
					name: "delete",
					description: "Delete the ticket system",
					type: 1,
					options: [
						{
							name: "channel",
							description: "The channel you want to delete",
							type: 7,
							// @ts-expect-error
							channelTypes: [0],
							required: true,
						},
					],
				},
				{
					name: "edit",
					description: "Edit the ticket system",
					type: 1,
					options: [
						{
							name: "channel",
							description: "The channel you want to edit",
							type: 7,
							// @ts-expect-error
							channelTypes: [0],
							required: true,
						},
					],
				},
				{
					name: "info",
					description: "Get the ticket system info",
					type: 1,
					options: [
						{
							name: "channel",
							description: "The channel you want to get the info",
							type: 7,
							// @ts-expect-error
							channelTypes: [0],
							required: true,
						},
					],
				},
				{
					name: "list",
					description: "Get all tickets panel",
					type: 1,
				},
			],
		});
	}

	// Helper function to validate emoji
	private isValidEmoji(emoji: string): boolean {
		// Check if it's a custom emoji
		const customEmoji = parseEmoji(emoji);
		if (customEmoji && customEmoji.id) return true;

		// Check if it's a standard emoji //:3821_redpanda_shrug~1:
		try {
			// Simple regex to check for emoji patterns
			return /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[\u2700-\u27bf]|[\uE000-\uF8FF]|\uD83C[\uDFFB-\uDFFF]|\uD83D[\uDFFB-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/.test(emoji);
		} catch {
			return false;
		}
	}

	// Helper function to create styled panels (Components V2)
	private createStyledPanel(title: string, description: string): ContainerBuilder {
		return new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🎫 ${title}**`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Ticket System • Made with ❤️`));
	}

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand(true, 0);

		if (subcommand === "create") {
			const welcomeEmbed = this.createStyledPanel(
				"Ticket System Creation",
				"Welcome to the interactive ticket setup wizard! Choose how you'd like to set up your ticket system:"
			);

			const styleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("auto_setup")
					.setLabel("Quick Setup")
					.setStyle(ButtonStyle.Primary)
					.setEmoji("🚀"),
				new ButtonBuilder()
					.setCustomId("manual_setup")
					.setLabel("Advanced Setup")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("🔧"),
				new ButtonBuilder()
					.setCustomId("template_setup")
					.setLabel("Use Templates")
					.setStyle(ButtonStyle.Success)
					.setEmoji("📝")
			);

			const message = await ctx.editOrReply({
				embeds: [welcomeEmbed],
				components: [styleRow],
			});

			const filter = (i: any) => {
				if (i.user.id !== ctx.author?.id) {
					i.reply({
						content: "This setup wizard is not for you! Please run your own `/ticket create` command.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			};

			const collector = message.createMessageComponentCollector({
				filter,
				time: 120000, // Increased timeout to 2 minutes
			});

			collector.on("collect", async (interaction) => {
				if (interaction.customId === "template_setup") {
					await interaction.deferUpdate();

					const templateSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
						new StringSelectMenuBuilder()
							.setCustomId("template_select")
							.setPlaceholder("Select a template")
							.addOptions([
								{
									label: "Support Ticket",
									value: "support",
									description: "General support ticket system",
									emoji: "🛠️"
								},
								{
									label: "Application System",
									value: "application",
									description: "Staff application ticket system",
									emoji: "📝"
								},
								{
									label: "Bug Report",
									value: "bug",
									description: "Bug report ticket system",
									emoji: "🐛"
								},
								{
									label: "Feedback System",
									value: "feedback",
									description: "User feedback ticket system",
									emoji: "💭"
								}
							])
					);

					await interaction.editReply({
						embeds: [this.createStyledPanel(
							"Template Selection",
							"Choose a pre-made template for your ticket system:"
						)],
						components: [templateSelect]
					});

					const templateMessage = await interaction.fetchReply();

					const templateCollector = templateMessage.createMessageComponentCollector({
						componentType: ComponentType.StringSelect,
						filter,
						time: 60000
					});

					templateCollector.on("collect", async (i) => {
						await i.deferUpdate();
						const selectedTemplate = i.values[0];

						// Create ticket system based on selected template
						let templateTitle = "Need Help?";
						let templateDesc = "Click the button below to create a ticket!";
						let buttonLabel = "Create Ticket";
						let buttonEmoji = ctx.client.config.emojis.ticket;
						let buttonColor = ButtonStyle.Primary;

						switch (selectedTemplate) {
							case "support":
								templateTitle = "Need Support?";
								templateDesc = "If you need assistance from our team, please click the button below to open a support ticket.";
								buttonLabel = "Open Support Ticket";
								buttonEmoji = "🛠️";
								buttonColor = ButtonStyle.Primary;
								break;
							case "application":
								templateTitle = "Staff Applications";
								templateDesc = "Want to join our team? Click the button below to start your application process!";
								buttonLabel = "Apply Now";
								buttonEmoji = "📝";
								buttonColor = ButtonStyle.Success;
								break;
							case "bug":
								templateTitle = "Report a Bug";
								templateDesc = "Found a bug? Click the button below to report it to our team.";
								buttonLabel = "Report Bug";
								buttonEmoji = "🐛";
								buttonColor = ButtonStyle.Danger;
								break;
							case "feedback":
								templateTitle = "Share Your Feedback";
								templateDesc = "We value your opinion! Click the button below to share your feedback with us.";
								buttonLabel = "Give Feedback";
								buttonEmoji = "💭";
								buttonColor = ButtonStyle.Secondary;
								break;
						}

						// Create the actual ticket system
						await this.setupTicketSystem(ctx, i as any, {
							title: templateTitle,
							description: templateDesc,
							buttonLabel: buttonLabel,
							buttonEmoji: buttonEmoji,
							buttonColor: buttonColor
						});
					});
				}
				else if (interaction.customId === "auto_setup") {
					await interaction.deferUpdate();

					// Auto setup with prettier defaults
					await this.setupTicketSystem(ctx, interaction as ButtonInteraction, {
						title: "Need Help?",
						description: "Click the button below to create a ticket! Our support team will assist you as soon as possible.",
						buttonLabel: "Create Ticket",
						buttonEmoji: ctx.client.config.emojis.ticket,
						buttonColor: ButtonStyle.Primary
					});
				}
				else if (interaction.customId === "manual_setup") {
					// Show options for manual setup
					await this.startManualSetup(ctx, interaction);
				}
			});

			collector.on("end", async (collected, reason) => {
				if (reason === "time" && collected.size === 0) {
					await message.edit({
						embeds: [this.createStyledPanel(
							"Setup Wizard Closed",
							"The ticket setup wizard has timed out. Please run the command again if you want to create a ticket system."
						)],
						components: []
					});
				}
			});
		}
		else if (subcommand === "delete") {
			const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
			if (!channel) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> Channel not found.",
				});
			}

			const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);

			if (!ticketConfig) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> No ticket system found in this channel.",
				});
			}

			const confirmEmbed = this.createStyledPanel(
				"Delete Ticket System",
				`Are you sure you want to delete the ticket system in <#${channel.id}>? This action cannot be undone.`
			);

			const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("confirm_delete")
					.setLabel("Yes, Delete It")
					.setStyle(ButtonStyle.Danger)
					.setEmoji("🗑️"),
				new ButtonBuilder()
					.setCustomId("cancel_delete")
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("<:Cross:1375519752746958858>")
			);

			const message = await ctx.editOrReply({
				embeds: [confirmEmbed],
				components: [confirmRow]
			});

			const filter = (i: any) => {
				if (i.user.id !== ctx.author?.id) {
					i.reply({
						content: "This action is not for you.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			};

			const collector = message.createMessageComponentCollector({
				filter,
				time: 30000,
				max: 1
			});

			collector.on("collect", async (interaction) => {
				if (interaction.customId === "confirm_delete") {
					await interaction.deferUpdate();

					// Get original ticket message
					try {
						const ticketChannel = ctx.guild.channels.cache.get(ticketConfig.channelId!) as TextChannel;
						if (ticketChannel) {
							const ticketMessage = await ticketChannel.messages.fetch(ticketConfig.messageId!).catch(() => null);
							if (ticketMessage) {
								await ticketMessage.delete().catch(() => null);
							}
						}
					} catch (error) {
						console.error("Error deleting ticket message:", error);
					}

					// Delete ticket config from database
					await TicketConfig.delete(ticketConfig.id);

					await interaction.editReply({
						embeds: [this.createStyledPanel(
							"Ticket System Deleted",
							`<:Tick:1375519268292264012> Successfully deleted the ticket system in <#${channel.id}>.`
						)],
						components: []
					});
				} else if (interaction.customId === "cancel_delete") {
					await interaction.deferUpdate();

					await interaction.editReply({
						embeds: [this.createStyledPanel(
							"Action Cancelled",
							"The deletion has been cancelled."
						)],
						components: []
					});
				}
			});

			collector.on("end", async (collected, reason) => {
				if (reason === "time" && collected.size === 0) {
					await message.edit({
						embeds: [this.createStyledPanel(
							"Action Cancelled",
							"The deletion has been cancelled due to timeout."
						)],
						components: []
					});
				}
			});
		}
		else if (subcommand === "edit") {
			const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
			if (!channel) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> Channel not found.",
				});
			}

			const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);

			if (!ticketConfig) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> No ticket system found in this channel.",
				});
			}

			// Get the ticket message
			const ticketChannel = ctx.guild.channels.cache.get(ticketConfig.channelId!) as TextChannel;
			if (!ticketChannel) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> Ticket channel not found.",
				});
			}

			const ticketMessage = await ticketChannel.messages.fetch(ticketConfig.messageId!).catch(() => null);

			if (!ticketMessage) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> Ticket message not found.",
				});
			}

			const editEmbed = this.createStyledPanel(
				"Edit Ticket System",
				"Choose what you want to edit:"
			);

			const editRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("edit_options")
					.setPlaceholder("Select what to edit")
					.addOptions([
						{
							label: "Edit Embed",
							value: "edit_embed",
							description: "Edit the ticket panel embed",
							emoji: "📝"
						},
						{
							label: "Edit Button",
							value: "edit_button",
							description: "Edit the ticket button",
							emoji: "🔘"
						},
						{
							label: "Add Support Role",
							value: "add_role",
							description: "Add a support role",
							emoji: "👥"
						},
						{
							label: "Add Logger Channel",
							value: "add_logger",
							description: "Add a logger channel",
							emoji: "📊"
						},
						{
							label: "Set Open Limit",
							value: "add_open_limit",
							description: "Set maximum open tickets per user",
							emoji: "🔢"
						},
						{
							label: "Change Categories",
							value: "change_categories",
							description: "Change ticket categories",
							emoji: "📁"
						}
					])
			);

			const message = await ctx.editOrReply({
				embeds: [editEmbed],
				components: [editRow]
			});

			const filter = (i: any) => {
				if (i.user.id !== ctx.author?.id) {
					i.reply({
						content: "This action is not for you.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			};

			const collector = message.createMessageComponentCollector({
				filter,
				time: 60000
			});

			collector.on("collect", async (interaction) => {
				if (interaction.isStringSelectMenu() && interaction.customId === "edit_options") {
					const selectedOption = interaction.values[0];

					switch (selectedOption) {
						case "edit_embed":
							await this.handleEditEmbed(ctx, interaction, ticketMessage);
							break;
						case "edit_button":
							await this.handleEditButton(ctx, interaction as any, ticketMessage);
							break;
						case "add_role":
							await this.handleAddRole(ctx, interaction, ticketConfig);
							break;
						case "add_logger":
							await this.handleAddLogger(ctx, interaction, ticketConfig);
							break;
						case "add_open_limit":
							await this.handleOpenLimit(ctx, interaction, ticketConfig);
							break;
						case "change_categories":
							await this.handleChangeCategories(ctx, interaction as any, ticketConfig);
							break;
					}
				}
			});
		}
		else if (subcommand === "info") {
			const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
			if (!channel) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> Channel not found.",
				});
			}

			const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);

			if (!ticketConfig) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> No ticket system found in this channel.",
				});
			}

			const infoEmbed = this.createStyledPanel(
				"Ticket System Info",
				[
					`**Panel Channel:** <#${ticketConfig.channelId}>`,
					`**Category:** <#${ticketConfig.categoryId}>`,
					`**Open Category:** <#${ticketConfig.openCategoryId}>`,
					`**Message ID:** \`${ticketConfig.messageId}\``,
					`**Support Roles:** ${ticketConfig.supportRoles.length ? ticketConfig.supportRoles.map(role => `<@&${role}>`).join(", ") : "None"}`,
					`**Open Limit:** ${ticketConfig.openLimit || "None"}`,
					`**Logger Channel:** ${ticketConfig.loggerChannelId ? `<#${ticketConfig.loggerChannelId}>` : "None"}`,
				].join("\n")
			);

			const actionsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("edit_this")
					.setLabel("Edit This System")
					.setStyle(ButtonStyle.Primary)
					.setEmoji("✏️"),
				new ButtonBuilder()
					.setCustomId("delete_this")
					.setLabel("Delete This System")
					.setStyle(ButtonStyle.Danger)
					.setEmoji("🗑️")
			);

			const message = await ctx.editOrReply({
				embeds: [infoEmbed],
				components: [actionsRow]
			});

			const filter = (i: any) => {
				if (i.user.id !== ctx.author?.id) {
					i.reply({
						content: "This action is not for you.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			};

			const collector = message.createMessageComponentCollector({
				filter,
				time: 60000
			});

			collector.on("collect", async (interaction) => {
				if (interaction.customId === "edit_this") {
					await interaction.deferUpdate();
					// Re-use the edit command logic
					ctx.options = {
						getSubCommand: () => "edit",
						getChannel: () => channel
					} as any;
					await this.run(ctx);
				} else if (interaction.customId === "delete_this") {
					await interaction.deferUpdate();
					// Re-use the delete command logic
					ctx.options = {
						getSubCommand: () => "delete",
						getChannel: () => channel
					} as any;
					await this.run(ctx);
				}
			});
		}
		else if (subcommand === "list") {
			const ticketConfigs = await TicketConfig.getAllByGuildId(ctx.guild.id);

			if (!ticketConfigs || ticketConfigs.length === 0) {
				return ctx.editOrReply({
					content: "<:Cross:1375519752746958858> No ticket systems found in this server.",
				});
			}

			const listEmbed = this.createStyledPanel(
				"Ticket Systems List",
				`Found ${ticketConfigs.length} ticket system${ticketConfigs.length > 1 ? 's' : ''} in this server:`
			);

			// Add field for each ticket system
			ticketConfigs.forEach((config, index) => {
				listEmbed.addFields({
					name: `Ticket System #${index + 1}`,
					value: [
						`**Channel:** <#${config.channelId}>`,
						`**Support Roles:** ${config.supportRoles.length ? config.supportRoles.map(role => `<@&${role}>`).join(", ") : "None"}`,
						`**Open Limit:** ${config.openLimit || "None"}`,
						`**Use:** \`/ticket info channel: #${ctx.guild.channels.cache.get(config.channelId!)?.name}\` for more details`,
					].join("\n"),
					inline: false
				});
			});

			await ctx.editOrReply({
				embeds: [listEmbed]
			});
		}
	}

	private async setupTicketSystem(ctx: Context, interaction: ButtonInteraction, options: {
		title: string;
		description: string;
		buttonLabel: string;
		buttonEmoji: string;
		buttonColor: ButtonStyle;
	}) {
		const category = await ctx.guild.channels.create({
			name: "📝 Tickets",
			type: ChannelType.GuildCategory,
		});

		const channel = await ctx.guild.channels.create({
			name: "ticket-panel",
			type: ChannelType.GuildText,
			parent: category.id,
		});

		const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("create_ticket")
				.setLabel(options.buttonLabel)
				.setStyle(options.buttonColor)
				.setEmoji(options.buttonEmoji)
		);

		const embed = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${options.title}**`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(options.description))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ctx.guild.name} • Ticket System`));

		const message = await channel?.send({
			components: [embed, button],
			flags: MessageFlags.IsComponentsV2,
		});

		if (!message) {
			return interaction.editReply({
				content: "<:Cross:1375519752746958858> Failed to send the message.",
			});
		}

		const ticket = await TicketConfig.create({
			guildId: ctx.guild.id,
			channelId: channel.id,
			categoryId: category.id,
			openCategoryId: category.id,
			openLimit: 1,
			messageId: message.id,
			supportRoles: [],
			loggerChannelId: null,
		});

		const successEmbed = this.createStyledPanel(
			"Ticket System Created",
			[
				"<:Tick:1375519268292264012> Successfully created the ticket system!",
				"",
				`**Panel Channel:** <#${channel.id}>`,
				`**Category:** <#${category.id}>`,
				`**Panel Message:** [Click Here](${message.url})`,
				"",
				"**What would you like to do next?**"
			].join("\n")
		);

		const nextStepsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("add_options")
				.setLabel("Add More Options")
				.setStyle(ButtonStyle.Primary)
				.setEmoji("⚙️"),
			new ButtonBuilder()
				.setCustomId("customize_panel")
				.setLabel("Customize Panel")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("🎨"),
			new ButtonBuilder()
				.setCustomId("visit_channel")
				.setLabel("Visit Channel")
				.setStyle(ButtonStyle.Link)
				.setURL(message.url)
				.setEmoji("🔗")
		);

		await interaction.editReply({
			embeds: [successEmbed],
			components: [nextStepsRow],
		});

		const setupMessage = await interaction.fetchReply();

		const filter = (i: any) => {
			if (i.user.id !== ctx.author?.id) {
				i.reply({
					content: "This action is not for you.",
					flags: MessageFlags.Ephemeral,
				});
				return false;
			}
			return true;
		};

		const setupCollector = setupMessage.createMessageComponentCollector({
			filter,
			time: 300000, // 5 minutes
		});

		setupCollector.on("collect", async (i) => {
			if (i.customId === "add_options") {
				await i.deferUpdate();

				const optionsEmbed = this.createStyledPanel(
					"Additional Options",
					"Select what you want to add to your ticket system:"
				);

				const optionsRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId("add_options_select")
						.setPlaceholder("Select an option")
						.addOptions([
							{
								label: "Add Support Role",
								value: "add_role",
								description: "Add a role that can access tickets",
								emoji: "👥"
							},
							{
								label: "Add Logger Channel",
								value: "add_logger",
								description: "Add a channel for ticket logs",
								emoji: "📊"
							},
							{
								label: "Set Open Limit",
								value: "add_open_limit",
								description: "Set maximum open tickets per user",
								emoji: "🔢"
							}
						])
				);

				await i.editReply({
					embeds: [optionsEmbed],
					components: [optionsRow]
				});

				const optionsMessage = await i.fetchReply();

				const optionsCollector = optionsMessage.createMessageComponentCollector({
					filter,
					time: 60000
				});

				optionsCollector.on("collect", async (i) => {
					if (i.isStringSelectMenu() && i.customId === "add_options_select") {
						const selectedOption = i.values[0];

						switch (selectedOption) {
							case "add_role":
								await this.handleAddRole(ctx, i, ticket);
								break;
							case "add_logger":
								await this.handleAddLogger(ctx, i, ticket);
								break;
							case "add_open_limit":
								await this.handleOpenLimit(ctx, i, ticket);
								break;
						}
					}
				});
			}
			else if (i.customId === "customize_panel") {
				await i.deferUpdate();

				const customizeEmbed = this.createStyledPanel(
					"Customize Panel",
					"Select what you want to customize:"
				);

				const customizeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId("customize_select")
						.setPlaceholder("Select an option")
						.addOptions([
							{
								label: "Customize Embed",
								value: "customize_embed",
								description: "Edit the ticket panel embed",
								emoji: "📝"
							},
							{
								label: "Customize Button",
								value: "customize_button",
								description: "Edit the button style and label",
								emoji: "🔘"
							}
						])
				);

				await i.editReply({
					embeds: [customizeEmbed],
					components: [customizeRow]
				});

				const customizeMessage = await i.fetchReply();

				const customizeCollector = customizeMessage.createMessageComponentCollector({
					filter,
					time: 60000
				});

				customizeCollector.on("collect", async (i) => {
					if (i.isStringSelectMenu() && i.customId === "customize_select") {
						const selectedOption = i.values[0];

						if (selectedOption === "customize_embed") {
							await this.handleEditEmbed(ctx, i, message);
						}
						else if (selectedOption === "customize_button") {
							await this.handleEditButton(ctx, i as any, message);
						}
					}
				});
			}
		});
	}

	private async startManualSetup(ctx: Context, interaction: any) {

		const setupData = {
			step: 1,
			category: null,
			channel: null,
			title: "Need Help?",
			description: "Click the button below to create a ticket!",
			buttonLabel: "Create Ticket",
			buttonEmoji: "🎫",
			buttonStyle: ButtonStyle.Primary,
			supportRoles: [],
			openLimit: 1,
			loggerChannel: null
		};

		await this.showSetupStep(ctx, interaction, setupData);
	}

	public async startSetup(ctx: Context, interaction: any) {
		const setupData = {
			step: 1,
			userId: ctx.author?.id,
			category: null,
			channel: null,
			title: "Support Tickets",
			description: "Click the button below to create a support ticket.",
			buttonLabel: "Create Ticket",
			buttonEmoji: "🎫",
			buttonStyle: ButtonStyle.Primary,
			supportRoles: [],
			openLimit: 1,
			loggerChannel: null
		};

		this.setupSessions.set(ctx.author?.id, setupData);
		await this.showSetupStep(ctx, interaction, setupData);
	}

	private async showSetupStep(ctx: Context, interaction: any, setupData: any) {
		const steps = [
			"Select Category",
			"Select Channel",
			"Customize Embed",
			"Customize Button",
			"Additional Settings",
			"Confirm & Create"
		];

		let embed: ContainerBuilder;
		let components: ActionRowBuilder<any>[] = [];

		switch (setupData.step) {
			case 1: {
				// Step 1: Select Category
				embed = this.createStyledPanel(
					"Manual Setup - Step 1/6",
					[
						"**Select a category where tickets will be created**",
						"",
						"📁 Choose an existing category or we'll create a new one if none selected.",
						"",
						`**Progress:** ${steps.slice(0, setupData.step - 1).map(s => `<:Tick:1375519268292264012> ${s}`).join("\n") || "Getting started..."}`,
						`**Current:** 🔄 ${steps[setupData.step - 1]}`,
						`**Next:** ⏭️ ${steps.slice(setupData.step).join(" → ")}`
					].join("\n")
				);

				const categorySelect = new ChannelSelectMenuBuilder()
					.setCustomId("setup_category_select")
					.setPlaceholder("Select a category (optional)")
					.setChannelTypes([ChannelType.GuildCategory])
					.setMinValues(0)
					.setMaxValues(1);

				const skipCategoryBtn = new ButtonBuilder()
					.setCustomId("skip_category")
					.setLabel("Skip (Create New Category)")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⏭️");

				components = [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(categorySelect),
					new ActionRowBuilder<ButtonBuilder>().addComponents(skipCategoryBtn)
				];
				break;
			}

			case 2: {
				// Step 2: Select Channel
				embed = this.createStyledPanel(
					"Manual Setup - Step 2/6",
					[
						"**Select a channel for the ticket panel**",
						"",
						"📝 Choose where users will see the ticket creation button.",
						setupData.category ? `**Selected Category:** <#${setupData.category}> <:Tick:1375519268292264012>` : "**Category:** Will create new category <:Tick:1375519268292264012>",
						"",
						`**Progress:** ${steps.slice(0, setupData.step - 1).map(s => `<:Tick:1375519268292264012> ${s}`).join("\n")}`,
						`**Current:** 🔄 ${steps[setupData.step - 1]}`,
						`**Next:** ⏭️ ${steps.slice(setupData.step).join(" → ")}`
					].join("\n")
				);

				const channelSelect = new ChannelSelectMenuBuilder()
					.setCustomId("setup_channel_select")
					.setPlaceholder("Select a channel for ticket panel")
					.setChannelTypes([ChannelType.GuildText])
					.setMinValues(1)
					.setMaxValues(1);

				const backBtn = new ButtonBuilder()
					.setCustomId("setup_back")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				components = [
					new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
					new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn)
				];
				break;
			}

			case 3: {
				// Step 3: Customize Embed
				embed = this.createStyledPanel(
					"Manual Setup - Step 3/6",
					[
						"**Customize the ticket panel embed**",
						"",
						"🎨 Set the title and description for your ticket panel.",
						setupData.category ? `**Category:** <#${setupData.category}> <:Tick:1375519268292264012>` : "**Category:** New category will be created <:Tick:1375519268292264012>",
						`**Channel:** <#${setupData.channel}> <:Tick:1375519268292264012>`,
						"",
						"**Current Settings:**",
						`**Title:** ${setupData.title}`,
						`**Description:** ${setupData.description}`,
						"",
						`**Progress:** ${steps.slice(0, setupData.step - 1).map(s => `<:Tick:1375519268292264012> ${s}`).join("\n")}`,
						`**Current:** 🔄 ${steps[setupData.step - 1]}`,
						`**Next:** ⏭️ ${steps.slice(setupData.step).join(" → ")}`
					].join("\n")
				);

				const customizeEmbedBtn = new ButtonBuilder()
					.setCustomId("customize_embed_modal")
					.setLabel("Customize Embed")
					.setStyle(ButtonStyle.Primary)
					.setEmoji("📝");

				const skipEmbedBtn = new ButtonBuilder()
					.setCustomId("skip_embed")
					.setLabel("Keep Default")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⏭️");

				const backBtn2 = new ButtonBuilder()
					.setCustomId("setup_back")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				components = [
					new ActionRowBuilder<ButtonBuilder>().addComponents(customizeEmbedBtn, skipEmbedBtn, backBtn2)
				];
				break;
			}

			case 4: {
				// Step 4: Customize Button
				embed = this.createStyledPanel(
					"Manual Setup - Step 4/6",
					[
						"**Customize the ticket creation button**",
						"",
						"🔘 Set the button text, emoji, and color.",
						setupData.category ? `**Category:** <#${setupData.category}> <:Tick:1375519268292264012>` : "**Category:** New category will be created <:Tick:1375519268292264012>",
						`**Channel:** <#${setupData.channel}> <:Tick:1375519268292264012>`,
						"**Embed:** Title & Description set <:Tick:1375519268292264012>",
						"",
						"**Current Button Settings:**",
						`**Label:** ${setupData.buttonLabel}`,
						`**Emoji:** ${setupData.buttonEmoji}`,
						`**Style:** ${ButtonStyle[setupData.buttonStyle]}`,
						"",
						`**Progress:** ${steps.slice(0, setupData.step - 1).map(s => `<:Tick:1375519268292264012> ${s}`).join("\n")}`,
						`**Current:** 🔄 ${steps[setupData.step - 1]}`,
						`**Next:** ⏭️ ${steps.slice(setupData.step).join(" → ")}`
					].join("\n")
				);

				const customizeButtonBtn = new ButtonBuilder()
					.setCustomId("customize_button_modal")
					.setLabel("Customize Button")
					.setStyle(ButtonStyle.Primary)
					.setEmoji("🔘");

				const skipButtonBtn = new ButtonBuilder()
					.setCustomId("skip_button")
					.setLabel("Keep Default")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⏭️");

				const backBtn3 = new ButtonBuilder()
					.setCustomId("setup_back")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				components = [
					new ActionRowBuilder<ButtonBuilder>().addComponents(customizeButtonBtn, skipButtonBtn, backBtn3)
				];
				break;
			}

			case 5: {
				// Step 5: Additional Settings
				embed = this.createStyledPanel(
					"Manual Setup - Step 5/6",
					[
						"**Additional settings (Optional)**",
						"",
						"⚙️ Configure support roles, open limits, and logging.",
						setupData.category ? `**Category:** <#${setupData.category}> <:Tick:1375519268292264012>` : "**Category:** New category will be created <:Tick:1375519268292264012>",
						`**Channel:** <#${setupData.channel}> <:Tick:1375519268292264012>`,
						"**Embed:** Customized <:Tick:1375519268292264012>",
						"**Button:** Customized <:Tick:1375519268292264012>",
						"",
						"**Current Additional Settings:**",
						`**Support Roles:** ${setupData.supportRoles.length ? setupData.supportRoles.map((r: string) => `<@&${r}>`).join(", ") : "None"}`,
						`**Open Limit:** ${setupData.openLimit}`,
						`**Logger Channel:** ${setupData.loggerChannel ? `<#${setupData.loggerChannel}>` : "None"}`,
						"",
						`**Progress:** ${steps.slice(0, setupData.step - 1).map(s => `<:Tick:1375519268292264012> ${s}`).join("\n")}`,
						`**Current:** 🔄 ${steps[setupData.step - 1]}`,
						`**Next:** ⏭️ ${steps[setupData.step]}`
					].join("\n")
				);

				const additionalSelect = new StringSelectMenuBuilder()
					.setCustomId("additional_settings_select")
					.setPlaceholder("Select what to configure (optional)")
					.addOptions([
						{
							label: "Add Support Roles",
							value: "add_support_roles",
							description: "Add roles that can manage tickets",
							emoji: "👥"
						},
						{
							label: "Set Open Limit",
							value: "set_open_limit",
							description: "Maximum tickets per user",
							emoji: "🔢"
						},
						{
							label: "Add Logger Channel",
							value: "add_logger_channel",
							description: "Channel for ticket logs",
							emoji: "📊"
						}
					]);

				const skipAdditionalBtn = new ButtonBuilder()
					.setCustomId("skip_additional")
					.setLabel("Skip Additional Settings")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⏭️");

				const backBtn4 = new ButtonBuilder()
					.setCustomId("setup_back")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				components = [
					new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(additionalSelect),
					new ActionRowBuilder<ButtonBuilder>().addComponents(skipAdditionalBtn, backBtn4)
				];
				break;
			}

			case 6: {
				// Step 6: Confirm & Create
				embed = this.createStyledPanel(
					"Manual Setup - Step 6/6",
					[
						"**Review and confirm your ticket system**",
						"",
						"<:Tick:1375519268292264012> **All Steps Completed!**",
						"",
						"**📋 Summary:**",
						setupData.category ? `**Category:** <#${setupData.category}>` : "**Category:** Will create new category",
						`**Channel:** <#${setupData.channel}>`,
						`**Title:** ${setupData.title}`,
						`**Description:** ${setupData.description}`,
						`**Button:** ${setupData.buttonEmoji} ${setupData.buttonLabel}`,
						`**Support Roles:** ${setupData.supportRoles.length ? setupData.supportRoles.map((r: string) => `<@&${r}>`).join(", ") : "None"}`,
						`**Open Limit:** ${setupData.openLimit}`,
						`**Logger Channel:** ${setupData.loggerChannel ? `<#${setupData.loggerChannel}>` : "None"}`,
						"",
						"**Ready to create your ticket system?**"
					].join("\n")
				);

				const createBtn = new ButtonBuilder()
					.setCustomId("create_system")
					.setLabel("Create Ticket System")
					.setStyle(ButtonStyle.Success)
					.setEmoji("<:Tick:1375519268292264012>");

				const backBtn5 = new ButtonBuilder()
					.setCustomId("setup_back")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				const cancelBtn = new ButtonBuilder()
					.setCustomId("cancel_setup")
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Danger)
					.setEmoji("<:Cross:1375519752746958858>");

				components = [
					new ActionRowBuilder<ButtonBuilder>().addComponents(createBtn, backBtn5, cancelBtn)
				];
				break;
			}
		}

		try {

			const message = await interaction.update({
				embeds: [embed!],
				components: components,
				ephemeral: false
			});

			// Create collector for the message
			const collector = message.createMessageComponentCollector({
				filter: (i: any) => {
					if (i.user.id !== ctx.author?.id) {
						i.reply({
							content: "<:Cross:1375519752746958858> This setup is not for you.",
							ephemeral: true
						});
						return false;
					}
					return true;
				},
				time: 300000 // 5 minutes
			});

			collector.on("collect", async (i: any) => {
				try {
					await this.handleSetupInteraction(ctx, i, setupData);
				} catch {

				}
			});

			collector.on("end", async (collected: any, reason: string) => {
				if (reason === 'time') {
					try {
						await interaction.editReply({
							content: "⏰ Setup timed out. Please run the setup command again.",
							embeds: [],
							components: []
						});
					} catch (error) {
						console.error("Error updating timed out message:", error);
					}
				}
				// Clean up session
				this.setupSessions.delete(ctx.author?.id);
			});

		} catch (error) {
			console.error("Error in showSetupStep:", error);
			await interaction.reply({
				content: "<:Cross:1375519752746958858> An error occurred while setting up the ticket system.",
				ephemeral: true
			});
		}
	}

	private async handleSetupInteraction(ctx: Context, interaction: any, setupData: any) {
		const { customId } = interaction;

		switch (customId) {
			case "setup_category_select": {
				if (interaction.values && interaction.values.length > 0) {
					setupData.category = interaction.values[0];
				} else {
					setupData.category = null;
				}
				setupData.step = 2;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "skip_category": {
				setupData.category = null;
				setupData.step = 2;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "setup_channel_select": {
				setupData.channel = interaction.values[0];
				setupData.step = 3;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "customize_embed_modal": {
				const modal = new ModalBuilder()
					.setCustomId("embed_customization_modal")
					.setTitle("Customize Embed");

				const titleInput = new TextInputBuilder()
					.setCustomId("embed_title")
					.setLabel("Embed Title")
					.setStyle(TextInputStyle.Short)
					.setValue(setupData.title)
					.setMaxLength(256)
					.setRequired(true);

				const descriptionInput = new TextInputBuilder()
					.setCustomId("embed_description")
					.setLabel("Embed Description")
					.setStyle(TextInputStyle.Paragraph)
					.setValue(setupData.description)
					.setMaxLength(4000)
					.setRequired(true);

				modal.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
					new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
				);

				await interaction.showModal(modal);

				// Wait for modal submission
				try {
					const modalInteraction = await interaction.awaitModalSubmit({
						time: 300000,
						filter: (i: any) => i.customId === "embed_customization_modal" && i.user.id === ctx.author?.id
					});

					setupData.title = modalInteraction.fields.getTextInputValue("embed_title");
					setupData.description = modalInteraction.fields.getTextInputValue("embed_description");
					setupData.step = 4;
					await this.showSetupStep(ctx, modalInteraction, setupData);
				} catch (error) {
					console.error("Modal timeout or error:", error);
				}
				break;
			}

			case "skip_embed": {
				setupData.step = 4;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "customize_button_modal": {
				const modal = new ModalBuilder()
					.setCustomId("button_customization_modal")
					.setTitle("Customize Button");

				const labelInput = new TextInputBuilder()
					.setCustomId("button_label")
					.setLabel("Button Label")
					.setStyle(TextInputStyle.Short)
					.setValue(setupData.buttonLabel)
					.setMaxLength(80)
					.setRequired(true);

				const emojiInput = new TextInputBuilder()
					.setCustomId("button_emoji")
					.setLabel("Button Emoji")
					.setStyle(TextInputStyle.Short)
					.setValue(setupData.buttonEmoji)
					.setMaxLength(10)
					.setRequired(false);

				modal.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput),
					new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput)
				);

				await interaction.showModal(modal);

				try {
					const modalInteraction = await interaction.awaitModalSubmit({
						time: 300000,
						filter: (i: any) => i.customId === "button_customization_modal" && i.user.id === ctx.author?.id
					});

					setupData.buttonLabel = modalInteraction.fields.getTextInputValue("button_label");
					const emoji = modalInteraction.fields.getTextInputValue("button_emoji");
					if (emoji) setupData.buttonEmoji = emoji;
					setupData.step = 5;
					await this.showSetupStep(ctx, modalInteraction, setupData);
				} catch (error) {
					console.error("Modal timeout or error:", error);
				}
				break;
			}

			case "skip_button": {
				setupData.step = 5;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "additional_settings_select": {
				const selectedValue = interaction.values[0];
				await this.handleAdditionalSetting(ctx, interaction, setupData, selectedValue);
				break;
			}

			case "skip_additional": {
				setupData.step = 6;
				await this.showSetupStep(ctx, interaction, setupData);
				break;
			}

			case "setup_back": {
				if (setupData.step > 1) {
					setupData.step--;
					await this.showSetupStep(ctx, interaction, setupData);
				}
				break;
			}

			case "create_system": {
				await this.createTicketSystem(ctx, interaction, setupData);
				break;
			}

			case "cancel_setup": {
				this.setupSessions.delete(ctx.author?.id);
				await interaction.update({
					content: "<:Cross:1375519752746958858> Ticket system setup cancelled.",
					embeds: [],
					components: []
				});
				break;
			}
		}
	}

	private async handleAdditionalSetting(ctx: Context, interaction: any, setupData: any, setting: string) {
		switch (setting) {
			case "add_support_roles": {
				const embed = this.createStyledPanel(
					"Add Support Roles",
					"Select roles that can manage tickets:"
				);

				const roleSelect = new RoleSelectMenuBuilder()
					.setCustomId("support_roles_select")
					.setPlaceholder("Select support roles")
					.setMinValues(1)
					.setMaxValues(10);

				const backBtn = new ButtonBuilder()
					.setCustomId("back_to_additional")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				await interaction.update({
					embeds: [embed],
					components: [
						new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
						new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn)
					]
				});

				// Wait for role selection
				const collector = interaction.message.createMessageComponentCollector({
					filter: (i: any) => i.user.id === ctx.author?.id,
					time: 60000
				});

				collector.on("collect", async (i: any) => {
					if (i.customId === "support_roles_select") {
						setupData.supportRoles = i.values;
						setupData.step = 5;
						await this.showSetupStep(ctx, i, setupData);
					} else if (i.customId === "back_to_additional") {
						setupData.step = 5;
						await this.showSetupStep(ctx, i, setupData);
					}
					collector.stop();
				});
				break;
			}

			case "set_open_limit": {
				const modal = new ModalBuilder()
					.setCustomId("open_limit_modal")
					.setTitle("Set Open Ticket Limit");

				const limitInput = new TextInputBuilder()
					.setCustomId("open_limit")
					.setLabel("Maximum tickets per user (1-10)")
					.setStyle(TextInputStyle.Short)
					.setValue(setupData.openLimit.toString())
					.setMaxLength(2)
					.setRequired(true);

				modal.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput)
				);

				await interaction.showModal(modal);

				try {
					const modalInteraction = await interaction.awaitModalSubmit({
						time: 60000,
						filter: (i: any) => i.customId === "open_limit_modal" && i.user.id === ctx.author?.id
					});

					const limit = Number.parseInt(modalInteraction.fields.getTextInputValue("open_limit"));
					if (limit >= 1 && limit <= 10) {
						setupData.openLimit = limit;
					}
					setupData.step = 5;
					await this.showSetupStep(ctx, modalInteraction, setupData);
				} catch (error) {
					console.error("Modal timeout or error:", error);
				}
				break;
			}

			case "add_logger_channel": {
				const embed = this.createStyledPanel(
					"Add Logger Channel",
					"Select a channel for ticket logs:"
				);

				const channelSelect = new ChannelSelectMenuBuilder()
					.setCustomId("logger_channel_select")
					.setPlaceholder("Select logger channel")
					.setChannelTypes([ChannelType.GuildText])
					.setMinValues(1)
					.setMaxValues(1);

				const backBtn = new ButtonBuilder()
					.setCustomId("back_to_additional")
					.setLabel("Back")
					.setStyle(ButtonStyle.Secondary)
					.setEmoji("⬅️");

				await interaction.update({
					embeds: [embed],
					components: [
						new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
						new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn)
					]
				});

				const collector = interaction.message.createMessageComponentCollector({
					filter: (i: any) => i.user.id === ctx.author?.id,
					time: 60000
				});

				collector.on("collect", async (i: any) => {
					if (i.customId === "logger_channel_select") {
						setupData.loggerChannel = i.values[0];
						setupData.step = 5;
						await this.showSetupStep(ctx, i, setupData);
					} else if (i.customId === "back_to_additional") {
						setupData.step = 5;
						await this.showSetupStep(ctx, i, setupData);
					}
					collector.stop();
				});
				break;
			}
		}
	}

	private async createTicketSystem(ctx: Context, interaction: any, setupData: any) {
		try {
			await interaction.deferUpdate();

			// Create category if needed
			let categoryId = setupData.category;
			if (!categoryId) {
				const category = await interaction.guild?.channels.create({
					name: "🎫 Support Tickets",
					type: ChannelType.GuildCategory,
					permissionOverwrites: [
						{
							id: interaction.guild.roles.everyone.id,
							deny: ["ViewChannel"]
						}
					]
				});
				categoryId = category?.id;
			}

			// Create ticket panel container
			const ticketEmbed = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${setupData.title}**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(setupData.description))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Click the button below to create a ticket"));

			// Create ticket button
			const ticketButton = new ButtonBuilder()
				.setCustomId("create_ticket")
				.setLabel(setupData.buttonLabel)
				.setStyle(setupData.buttonStyle)
				.setEmoji(setupData.buttonEmoji);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(ticketButton);

			// Send ticket panel to selected channel
			let message: any;
			const channel = interaction.guild?.channels.cache.get(setupData.channel);
			if (channel && channel.isTextBased()) {
				message = await channel.send({
					components: [ticketEmbed, row],
					flags: MessageFlags.IsComponentsV2,
				});
			}

			// Save configuration to database (implement your database logic here)
			await TicketConfig.create({
				guildId: interaction.guild?.id,
				channelId: setupData.channel,
				categoryId: categoryId,
				supportRoles: setupData.supportRoles,
				openLimit: setupData.openLimit,
				loggerChannelId: setupData.loggerChannel,
				messageId: message?.id,
				openCategoryId: categoryId
			})

			// Success message
			const successEmbed = this.createStyledPanel(
				"<:Tick:1375519268292264012> Ticket System Created Successfully!",
				[
					`**Ticket panel sent to:** <#${setupData.channel}>`,
					categoryId ? `**Category:** <#${categoryId}>` : "",
					`**Support Roles:** ${setupData.supportRoles.length ? setupData.supportRoles.map((r: string) => `<@&${r}>`).join(", ") : "None"}`,
					`**Open Limit:** ${setupData.openLimit} per user`,
					setupData.loggerChannel ? `**Logger Channel:** <#${setupData.loggerChannel}>` : "",
					"",
					"Your ticket system is now active! Users can create tickets by clicking the button."
				].filter(Boolean).join("\n")
			);

			await interaction.editReply({
				embeds: [successEmbed],
				components: []
			});

			// Clean up session
			this.setupSessions.delete(ctx.author?.id);

		} catch {

		}
	}

	private async showEmbedCustomizationModal(interaction: any, setupData: any) {
		const modal = new ModalBuilder()
			.setCustomId("embed_customization_modal")
			.setTitle("Customize Embed");

		const titleInput = new TextInputBuilder()
			.setCustomId("embed_title")
			.setLabel("Embed Title")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter embed title...")
			.setValue(setupData.title)
			.setMaxLength(256)
			.setRequired(true);

		const descriptionInput = new TextInputBuilder()
			.setCustomId("embed_description")
			.setLabel("Embed Description")
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder("Enter embed description...")
			.setValue(setupData.description)
			.setMaxLength(4000)
			.setRequired(true);

		const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput);
		const secondRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

		modal.addComponents(firstRow, secondRow);

		await interaction.showModal(modal);
	}

	private async showButtonCustomizationModal(interaction: any, setupData: any) {
		const modal = new ModalBuilder()
			.setCustomId("button_customization_modal")
			.setTitle("Customize Button");

		const labelInput = new TextInputBuilder()
			.setCustomId("button_label")
			.setLabel("Button Label")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter button text...")
			.setValue(setupData.buttonLabel)
			.setMaxLength(80)
			.setRequired(true);

		const emojiInput = new TextInputBuilder()
			.setCustomId("button_emoji")
			.setLabel("Button Emoji")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter emoji (e.g., 🎫)...")
			.setValue(setupData.buttonEmoji)
			.setMaxLength(10)
			.setRequired(false);

		const colorInput = new TextInputBuilder()
			.setCustomId("button_color")
			.setLabel("Button Color")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("primary, secondary, success, danger")
			.setValue(ButtonStyle[setupData.buttonStyle]!.toLowerCase())
			.setMaxLength(20)
			.setRequired(true);

		const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput);
		const secondRow = new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput);
		const thirdRow = new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput);

		modal.addComponents(firstRow, secondRow, thirdRow);

		await interaction.showModal(modal);
	}

	private async handleAdditionalSettings(ctx: Context, interaction: any, setupData: any, option: string) {
		switch (option) {
			case "add_support_roles":
				await this.handleSupportRolesSelection(ctx, interaction, setupData);
				break;
			case "set_open_limit":
				await this.handleOpenLimitSelection(ctx, interaction, setupData);
				break;
			case "add_logger_channel":
				await this.handleLoggerChannelSelection(ctx, interaction, setupData);
				break;
		}
	}

	private async handleSupportRolesSelection(ctx: Context, interaction: any, setupData: any) {
		const modal = new ModalBuilder()
			.setCustomId("support_roles_modal")
			.setTitle("Add Support Roles");

		const rolesInput = new TextInputBuilder()
			.setCustomId("support_roles")
			.setLabel("Support Roles")
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder("Enter role IDs or mention roles (e.g., @Support @Admin)")
			.setValue(setupData.supportRoles.map((r: string) => `<@&${r}>`).join(" "))
			.setMaxLength(1000)
			.setRequired(false);

		const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(rolesInput);
		modal.addComponents(firstRow);

		await interaction.showModal(modal);
	}

	private async handleOpenLimitSelection(ctx: Context, interaction: any, setupData: any) {
		const modal = new ModalBuilder()
			.setCustomId("open_limit_modal")
			.setTitle("Set Open Limit");

		const limitInput = new TextInputBuilder()
			.setCustomId("open_limit")
			.setLabel("Maximum Open Tickets Per User")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter a number (1-10)")
			.setValue(setupData.openLimit.toString())
			.setMaxLength(2)
			.setRequired(true);

		const firstRow = new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput);
		modal.addComponents(firstRow);

		await interaction.showModal(modal);
	}

	private async handleLoggerChannelSelection(ctx: Context, interaction: any, setupData: any) {
		const embed = this.createStyledPanel(
			"Select Logger Channel",
			"Choose a channel where ticket logs will be sent:"
		);

		const channelSelect = new ChannelSelectMenuBuilder()
			.setCustomId("logger_channel_select")
			.setPlaceholder("Select a channel for logs")
			.setChannelTypes([ChannelType.GuildText])
			.setMinValues(0)
			.setMaxValues(1);

		const backBtn = new ButtonBuilder()
			.setCustomId("back_to_additional")
			.setLabel("Back")
			.setStyle(ButtonStyle.Secondary)
			.setEmoji("⬅️");

		await interaction.update({
			embeds: [embed],
			components: [
				new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
				new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn)
			]
		});
	}

	private async createTicketSystemFromSetup(ctx: Context, interaction: any, setupData: any) {
		await interaction.deferUpdate();

		try {
			// Create category if not selected
			let categoryId = setupData.category;
			if (!categoryId) {
				const category = await ctx.guild.channels.create({
					name: "📝 Tickets",
					type: ChannelType.GuildCategory,
				});
				categoryId = category.id;
			}

			// Create the ticket panel message
			const embed = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${setupData.title}**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(setupData.description))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ctx.guild.name} • Ticket System`));

			const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("create_ticket")
					.setLabel(setupData.buttonLabel)
					.setStyle(setupData.buttonStyle)
					.setEmoji(setupData.buttonEmoji)
			);

			const channel = ctx.guild.channels.cache.get(setupData.channel) as TextChannel;
			const message = await channel.send({
				components: [embed, button],
				flags: MessageFlags.IsComponentsV2,
			});

			// Save to database
			const ticketConfig = await TicketConfig.create({
				guildId: ctx.guild.id,
				channelId: setupData.channel,
				categoryId: categoryId,
				openCategoryId: categoryId,
				openLimit: setupData.openLimit,
				messageId: message.id,
				supportRoles: setupData.supportRoles,
				loggerChannelId: setupData.loggerChannel,
			});

			const successEmbed = this.createStyledPanel(
				"Ticket System Created Successfully!",
				[
					"🎉 Your ticket system has been created and is now active!",
					"",
					"**📋 Summary:**",
					`**Panel Channel:** <#${setupData.channel}>`,
					`**Category:** <#${categoryId}>`,
					`**Panel Message:** [Click Here](${message.url})`,
					`**Support Roles:** ${setupData.supportRoles.length ? setupData.supportRoles.map((r: string) => `<@&${r}>`).join(", ") : "None"}`,
					`**Open Limit:** ${setupData.openLimit}`,
					`**Logger Channel:** ${setupData.loggerChannel ? `<#${setupData.loggerChannel}>` : "None"}`,
					"",
					"<:Tick:1375519268292264012> Users can now create tickets by clicking the button in the panel channel!",
					"",
					"**Need to make changes?** Use `/ticket edit` command."
				].join("\n")
			);

			const visitBtn = new ButtonBuilder()
				.setCustomId("visit_panel")
				.setLabel("Visit Panel")
				.setStyle(ButtonStyle.Link)
				.setURL(message.url)
				.setEmoji(ctx.client.config.emojis.link);

			await interaction.editReply({
				embeds: [successEmbed],
				components: [new ActionRowBuilder<ButtonBuilder>().addComponents(visitBtn)]
			});

		} catch (error) {
			console.error("Error creating ticket system:", error);

			const errorEmbed = this.createStyledPanel(
				"Error Creating Ticket System",
				"<:Cross:1375519752746958858> An error occurred while creating your ticket system. Please try again or contact support."
			);

			await interaction.editReply({
				embeds: [errorEmbed],
				components: []
			});
		}
	}

	private async handleEditEmbed(ctx: Context, interaction: any, ticketMessage: any) {

		// Create a modal for editing the embed
		const modal = new ModalBuilder()
			.setCustomId("edit_embed_modal")
			.setTitle("Edit Ticket Embed");

		// Add title input
		const titleInput = new TextInputBuilder()
			.setCustomId("embed_title")
			.setLabel("Embed Title")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter a title for the embed")
			.setValue(ticketMessage.embeds[0]?.title || "Need Help?")
			.setRequired(true)
			.setMaxLength(100);

		// Add description input
		const descriptionInput = new TextInputBuilder()
			.setCustomId("embed_description")
			.setLabel("Embed Description")
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder("Enter a description for the embed")
			.setValue(ticketMessage.embeds[0]?.description || "Click the button below to create a ticket!")
			.setRequired(true)
			.setMaxLength(4000);

		// Add color input
		const colorInput = new TextInputBuilder()
			.setCustomId("embed_color")
			.setLabel("Embed Color (hex code or color name)")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("#3498db or Blue")
			.setValue(ticketMessage.embeds[0]?.color ? `#${ticketMessage.embeds[0].color.toString(16)}` : "#3498db")
			.setRequired(false)
			.setMaxLength(20);

		// Add footer input
		const footerInput = new TextInputBuilder()
			.setCustomId("embed_footer")
			.setLabel("Footer Text (optional)")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter footer text")
			.setValue(ticketMessage.embeds[0]?.footer?.text || `${ctx.guild.name} • Ticket System`)
			.setRequired(false)
			.setMaxLength(100);

		// Create action rows for the inputs
		const titleRow = new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput);
		const descriptionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
		const colorRow = new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput);
		const footerRow = new ActionRowBuilder<TextInputBuilder>().addComponents(footerInput);

		// Add action rows to the modal
		modal.addComponents(titleRow, descriptionRow, colorRow, footerRow);

		// Show the modal
		await interaction.showModal(modal);

		try {
			// Wait for the modal submission
			const modalSubmit = await interaction.awaitModalSubmit({
				filter: (i: any) => i.customId === "edit_embed_modal" && i.user.id === ctx.author?.id,
				time: 120000 // 2 minutes
			});

			await modalSubmit.deferUpdate();

			// Get values from the modal
			const title = modalSubmit.fields.getTextInputValue("embed_title");
			const description = modalSubmit.fields.getTextInputValue("embed_description");
			const colorValue = modalSubmit.fields.getTextInputValue("embed_color") || "#3498db";
			const footerText = modalSubmit.fields.getTextInputValue("embed_footer") || `${ctx.guild.name} • Ticket System`;

			// Parse color (kept for reference but not used in V2)
			let _color: ColorResolvable = "#3498db";
			try {
				if (colorValue.startsWith("#")) {
					_color = colorValue as ColorResolvable;
				} else {
					_color = colorValue as ColorResolvable;
				}
			} catch (error) {
				console.error("Invalid color:", error);
			}

			// Create new container (Components V2)
			const newEmbed = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));

			// Edit the message
			await ticketMessage.edit({
				components: [newEmbed, ...ticketMessage.components.slice(1)],
				embeds: [],
				flags: MessageFlags.IsComponentsV2,
			});

			// Send success message
			await modalSubmit.editReply({
				components: [this.createStyledPanel(
					"Embed Updated",
					"<:Tick:1375519268292264012> Successfully updated the ticket embed!"
				)],
				flags: MessageFlags.IsComponentsV2,
				embeds: [],
			});
		} catch (error) {
			console.error("Modal error:", error);
			await interaction.editReply({
				embeds: [this.createStyledPanel(
					"Error",
					"<:Cross:1375519752746958858> There was an error updating the embed. Please try again."
				)],
				components: []
			}).catch(() => null);
		}
	}

	// Method to handle editing the ticket button
	private async handleEditButton(ctx: Context, interaction: ButtonInteraction, ticketMessage: any) {

		// Get the current button
		const currentButton = ticketMessage.components[0]?.components[0];

		// Create a modal for editing the button
		const modal = new ModalBuilder()
			.setCustomId("edit_button_modal")
			.setTitle("Edit Ticket Button");

		// Add label input
		const labelInput = new TextInputBuilder()
			.setCustomId("button_label")
			.setLabel("Button Label")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter a label for the button")
			.setValue(currentButton?.label || "Create Ticket")
			.setRequired(true)
			.setMaxLength(80);

		// Add emoji input
		const emojiInput = new TextInputBuilder()
			.setCustomId("button_emoji")
			.setLabel("Button Emoji (optional)")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter an emoji (e.g., 🎫)")
			.setValue(currentButton?.emoji?.name || "🎫")
			.setRequired(false)
			.setMaxLength(100);

		// Create action rows for the inputs
		const labelRow = new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput);
		const emojiRow = new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput);

		// Add action rows to the modal
		modal.addComponents(labelRow, emojiRow);

		// Show the modal
		await interaction.showModal(modal);

		try {
			// Wait for the modal submission
			const modalSubmit = await interaction.awaitModalSubmit({
				filter: (i: any) => i.customId === "edit_button_modal" && i.user.id === ctx.author?.id,
				time: 120000 // 2 minutes
			});

			await modalSubmit.deferUpdate();

			// Get values from the modal
			const label = modalSubmit.fields.getTextInputValue("button_label");
			const emoji = modalSubmit.fields.getTextInputValue("button_emoji") || ctx.client.config.emojis.ticket;

			// Validate emoji
			if (emoji && !this.isValidEmoji(emoji)) {
				return modalSubmit.editReply({
					embeds: [this.createStyledPanel(
						"Invalid Emoji",
						"<:Cross:1375519752746958858> The emoji you entered is invalid. Please use a valid emoji."
					)],
					components: []
				});
			}

			// Create style selector
			const styleEmbed = this.createStyledPanel(
				"Button Style",
				"Choose a style for your button:"
			);

			const styleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("style_primary")
					.setLabel("Primary")
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId("style_secondary")
					.setLabel("Secondary")
					.setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId("style_success")
					.setLabel("Success")
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId("style_danger")
					.setLabel("Danger")
					.setStyle(ButtonStyle.Danger)
			);

			await modalSubmit.editReply({
				embeds: [styleEmbed],
				components: [styleRow]
			});

			const styleMessage = await modalSubmit.fetchReply();

			const styleCollector = styleMessage.createMessageComponentCollector({
				filter: (i: any) => {
					if (i.user.id !== ctx.author?.id) {
						i.reply({
							content: "This action is not for you.",
							flags: MessageFlags.Ephemeral,
						});
						return false;
					}
					return true;
				},
				time: 60000
			});

			styleCollector.on("collect", async (i) => {
				await i.deferUpdate();

				// Determine button style
				let style = ButtonStyle.Primary;
				switch (i.customId) {
					case "style_primary":
						style = ButtonStyle.Primary;
						break;
					case "style_secondary":
						style = ButtonStyle.Secondary;
						break;
					case "style_success":
						style = ButtonStyle.Success;
						break;
					case "style_danger":
						style = ButtonStyle.Danger;
						break;
				}

				// Create new button
				const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId("create_ticket")
						.setLabel(label)
						.setStyle(style)
						.setEmoji(emoji)
				);

				// Edit the message
				await ticketMessage.edit({
					embeds: ticketMessage.embeds,
					components: [button]
				});

				// Send success message
				await i.editReply({
					embeds: [this.createStyledPanel(
						"Button Updated",
						"<:Tick:1375519268292264012> Successfully updated the ticket button!"
					)],
					components: []
				});
			});

			styleCollector.on("end", async (collected, reason) => {
				if (reason === "time" && collected.size === 0) {
					await modalSubmit.editReply({
						embeds: [this.createStyledPanel(
							"Action Cancelled",
							"The button style selection has timed out."
						)],
						components: []
					}).catch(() => null);
				}
			});
		} catch (error) {
			console.error("Modal error:", error);
			await interaction.editReply({
				embeds: [this.createStyledPanel(
					"Error",
					"<:Cross:1375519752746958858> There was an error updating the button. Please try again."
				)],
				components: []
			}).catch(() => null);
		}
	}

	// Method to handle adding a support role
	private async handleAddRole(ctx: Context, interaction: any, ticketConfig: any) {
		await interaction.deferUpdate();

		const roleSelector = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
			new RoleSelectMenuBuilder()
				.setCustomId("role_select")
				.setPlaceholder("Select support roles")
				.setMinValues(1)
				.setMaxValues(10)
		);

		await interaction.editReply({
			embeds: [this.createStyledPanel(
				"Select Support Roles",
				"Select the roles that should have access to tickets when they are created:"
			)],
			components: [roleSelector]
		});

		const message = await interaction.fetchReply();

		try {
			const roleInteraction = await message.awaitMessageComponent({
				filter: (i: any) => {
					if (i.user.id !== ctx.author?.id) {
						i.reply({
							content: "This action is not for you.",
							flags: MessageFlags.Ephemeral,
						});
						return false;
					}
					return true;
				},
				time: 60000
			});

			await roleInteraction.deferUpdate();

			// Get selected roles
			const selectedRoles = roleInteraction.values;

			// Update ticket config
			await TicketConfig.update(ticketConfig.id, {
				supportRoles: selectedRoles
			});

			await roleInteraction.editReply({
				embeds: [this.createStyledPanel(
					"Support Roles Added",
					`<:Tick:1375519268292264012> Successfully added ${selectedRoles.length} support role${selectedRoles.length > 1 ? 's' : ''}!`
				)],
				components: []
			});
		} catch (error) {
			console.error("Role selection error:", error);
			await interaction.editReply({
				embeds: [this.createStyledPanel(
					"Selection Timed Out",
					"You didn't select any roles in time. Please try again."
				)],
				components: []
			}).catch(() => null);
		}
	}

	// Method to handle adding a logger channel
	private async handleAddLogger(ctx: Context, interaction: any, ticketConfig: any) {
		await interaction.deferUpdate();

		const channelSelector = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
			new ChannelSelectMenuBuilder()
				.setCustomId("logger_channel_select")
				.setPlaceholder("Select a logger channel")
				.addChannelTypes(ChannelType.GuildText)
		);

		await interaction.editReply({
			embeds: [this.createStyledPanel(
				"Select Logger Channel",
				"Select a channel where ticket logs will be sent:"
			)],
			components: [channelSelector]
		});

		const message = await interaction.fetchReply();

		try {
			const channelInteraction = await message.awaitMessageComponent({
				filter: (i: any) => {
					if (i.user.id !== ctx.author?.id) {
						i.reply({
							content: "This action is not for you.",
							flags: MessageFlags.Ephemeral,
						});
						return false;
					}
					return true;
				},
				time: 60000
			});

			await channelInteraction.deferUpdate();

			// Get selected channel
			const selectedChannel = channelInteraction.values[0];

			// Update ticket config
			await TicketConfig.update(ticketConfig.id, {
				loggerChannelId: selectedChannel
			});

			await channelInteraction.editReply({
				embeds: [this.createStyledPanel(
					"Logger Channel Added",
					`<:Tick:1375519268292264012> Successfully set <#${selectedChannel}> as the logger channel!`
				)],
				components: []
			});
		} catch (error) {
			console.error("Channel selection error:", error);
			await interaction.editReply({
				embeds: [this.createStyledPanel(
					"Selection Timed Out",
					"You didn't select a channel in time. Please try again."
				)],
				components: []
			}).catch(() => null);
		}
	}

	// Method to handle setting open ticket limit
	private async handleOpenLimit(ctx: Context, interaction: any, ticketConfig: any) {

		// Create a modal for setting the open limit
		const modal = new ModalBuilder()
			.setCustomId("open_limit_modal")
			.setTitle("Set Open Ticket Limit");

		// Add limit input
		const limitInput = new TextInputBuilder()
			.setCustomId("open_limit")
			.setLabel("Maximum open tickets per user")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Enter a number (1-10)")
			.setValue(ticketConfig.openLimit?.toString() || "1")
			.setRequired(true)
			.setMaxLength(2);

		// Create action row for the input
		const limitRow = new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput);

		// Add action row to the modal
		modal.addComponents(limitRow);

		// Show the modal
		await interaction.showModal(modal);

		try {
			// Wait for the modal submission
			const modalSubmit = await interaction.awaitModalSubmit({
				filter: (i: any) => i.customId === "open_limit_modal" && i.user.id === ctx.author?.id,
				time: 60000
			});

			await modalSubmit.deferUpdate();

			// Get value from the modal
			const limitStr = modalSubmit.fields.getTextInputValue("open_limit");

			// Validate limit
			const limit = Number.parseInt(limitStr);
			if (Number.isNaN(limit) || limit < 1 || limit > 10) {
				return modalSubmit.editReply({
					embeds: [this.createStyledPanel(
						"Invalid Limit",
						"<:Cross:1375519752746958858> Please enter a valid number between 1 and 10."
					)],
					components: []
				});
			}

			// Update ticket config
			await TicketConfig.update(ticketConfig.id, {
				openLimit: limit
			});

			await modalSubmit.editReply({
				embeds: [this.createStyledPanel(
					"Open Limit Set",
					`<:Tick:1375519268292264012> Successfully set the open ticket limit to ${limit} per user!`
				)],
				components: []
			});
		} catch (error) {
			console.error("Modal error:", error);
			await interaction.editReply({
				embeds: [this.createStyledPanel(
					"Action Cancelled",
					"The limit setting has timed out."
				)],
				components: []
			}).catch(() => null);
		}
	}

	// Method to handle changing ticket categories
	private async handleChangeCategories(ctx: Context, interaction: any, ticketConfig: any) {
		await interaction.deferUpdate();

		const categoriesEmbed = this.createStyledPanel(
			"Change Categories",
			"Select what category you want to change:"
		);

		const categoriesRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("change_main_category")
				.setLabel("Change Main Category")
				.setStyle(ButtonStyle.Primary)
				.setEmoji("📁"),
			new ButtonBuilder()
				.setCustomId("change_open_category")
				.setLabel("Change Open Tickets Category")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("📂")
		);

		await interaction.editReply({
			embeds: [categoriesEmbed],
			components: [categoriesRow]
		});

		const message = await interaction.fetchReply();

		const collector = message.createMessageComponentCollector({
			filter: (i: any) => {
				if (i.user.id !== ctx.author?.id) {
					i.reply({
						content: "This action is not for you.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			},
			time: 60000
		});

		collector.on("collect", async (i: any) => {
			if (!i.deferred) await i.deferUpdate();

			const channelSelector = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
				new ChannelSelectMenuBuilder()
					.setCustomId(`${i.customId}_select`)
					.setPlaceholder("Select a category")
					.addChannelTypes(ChannelType.GuildCategory)
			);

			const title = i.customId === "change_main_category" ? "Select Main Category" : "Select Open Tickets Category";
			const description = i.customId === "change_main_category"
				? "Select the main category for the ticket system:"
				: "Select the category where open tickets will be placed:";

			await i.editReply({
				embeds: [this.createStyledPanel(
					title,
					description
				)],
				components: [channelSelector]
			});

			const categoryMessage = await i.fetchReply();

			try {
				const categoryInteraction = await categoryMessage.awaitMessageComponent({
					filter: (i: any) => {
						if (i.user.id !== ctx.author?.id) {
							i.reply({
								content: "This action is not for you.",
								flags: MessageFlags.Ephemeral,
							});
							return false;
						}
						return true;
					},
					time: 60000
				});

				await categoryInteraction.deferUpdate();

				// Get selected category
				const selectedCategory = categoryInteraction.values[0];

				// Update ticket config
				if (i.customId === "change_main_category") {
					await TicketConfig.update(ticketConfig.id, {
						openCategoryId: selectedCategory
					});
				} else {
					await TicketConfig.update(ticketConfig.id, {
						openCategoryId: selectedCategory
					});
				}

				await categoryInteraction.editReply({
					embeds: [this.createStyledPanel(
						"Category Updated",
						`<:Tick:1375519268292264012> Successfully updated the category to <#${selectedCategory}>!`
					)],
					components: []
				});
			} catch (error) {
				console.error("Category selection error:", error);
				await i.editReply({
					embeds: [this.createStyledPanel(
						"Selection Timed Out",
						"You didn't select a category in time. Please try again."
					)],
					components: []
				}).catch(() => null);
			}
		});

		collector.on("end", async (collected: any, reason: any) => {
			if (reason === "time" && collected.size === 0) {
				await message.edit({
					embeds: [this.createStyledPanel(
						"Action Cancelled",
						"The category selection has timed out."
					)],
					components: []
				}).catch(() => null);
			}
		});
	}
}
