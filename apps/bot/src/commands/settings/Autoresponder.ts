import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AutoResponder } from "@repo/db";

export default class Autoresponder extends Command {
	constructor() {
		super({
			name: "autoresponder",
			description: {
				content: "Manage automatic responses to specific triggers in your server.",
				usage: "autoresponder",
			},
			category: "settings",
			aliases: ["ar"],
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
	public async run(ctx: Context): Promise<any> {
		// Create buttons with improved labels and emoji indicators
		const addButton = new ButtonBuilder()
			.setCustomId("auto_responder_open_modal")
			.setLabel("Add Responder")
			.setEmoji("➕")
			.setStyle(ButtonStyle.Primary);

		const removeButton = new ButtonBuilder()
			.setCustomId("auto_responder_remove")
			.setLabel("Remove")
			.setEmoji("🗑️")
			.setStyle(ButtonStyle.Danger);

		const editButton = new ButtonBuilder()
			.setCustomId("auto_responder_edit")
			.setLabel("Edit")
			.setEmoji("✏️")
			.setStyle(ButtonStyle.Secondary);

		const listButton = new ButtonBuilder()
			.setCustomId("auto_responder_list")
			.setLabel("View All")
			.setEmoji("📋")
			.setStyle(ButtonStyle.Success);

		const clearButton = new ButtonBuilder()
			.setCustomId("auto_responder_clear")
			.setLabel("Clear All")
			.setEmoji("🧹")
			.setStyle(ButtonStyle.Secondary);

		// Primary action row with the most common operations
		const primaryRow = new ActionRowBuilder<ButtonBuilder>()
			.addComponents(addButton, editButton, listButton);

		// Secondary action row with destructive operations
		const secondaryRow = new ActionRowBuilder<ButtonBuilder>()
			.addComponents(removeButton, clearButton);

		// Create an improved embed with more information
		const embed = new EmbedBuilder()
			.setColor(ctx.client.config.colors.main)
			.setTitle("🤖 Autoresponder Manager")
			.setDescription("Set up automatic responses to specific messages in your server.")
			.addFields(
				{ name: "How it works", value: "When a user types a trigger word or pattern, the bot will automatically respond with your configured message." },
				{ name: "Getting Started", value: "Click the buttons below to manage your autoresponders." }
			)
			.setFooter({ text: "You must have the 'Manage Server' permission to use this command." });

		// Send initial message with components
		const msg = await ctx.editOrReply({
			components: [primaryRow, secondaryRow],
			embeds: [embed],
		});

		// Only allow the command author to interact with the buttons
		const filter = (i: any) => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({
				embeds: [
					new EmbedBuilder()
						.setColor(ctx.client.config.colors.red)
						.setDescription("<:Cross:1375519752746958858> You don't have permission to use these controls.")
				],
				flags: MessageFlags.Ephemeral,
			});
			return false;
		};

		// Create component collector
		const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, filter, idle: 300000 }); // Extended idle time to 5 minutes

		collector.on("collect", async (i) => {
			if (i.customId === "auto_responder_open_modal") {
				// Create modal for adding new responder with improved guidance
				const modal = new ModalBuilder()
					.setCustomId("auto_responder_modal")
					.setTitle("Create New Auto Responder");

				const nameInput = new TextInputBuilder()
					.setCustomId("name")
					.setLabel("Name (unique identifier)")
					.setPlaceholder("Enter a unique name like 'greeting' or 'faq'")
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const triggerInput = new TextInputBuilder()
					.setCustomId("trigger")
					.setLabel("Trigger Word/Pattern")
					.setPlaceholder("Word or regex pattern that will trigger the response")
					.setStyle(TextInputStyle.Short)
					.setRequired(true);

				const responseInput = new TextInputBuilder()
					.setCustomId("response")
					.setLabel("Response Message")
					.setPlaceholder("Message the bot will send when triggered")
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true);

				const regexInput = new TextInputBuilder()
					.setCustomId("use_regex")
					.setLabel("Use Regex? (yes/no)")
					.setPlaceholder("Type 'yes' to use regex pattern matching, 'no' for exact match")
					.setStyle(TextInputStyle.Short)
					.setRequired(false);

				const row0 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
				const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(triggerInput);
				const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(responseInput);
				const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(regexInput);

				modal.addComponents(row0, row1, row2, row3);

				await i.showModal(modal);
				await i
					.awaitModalSubmit({
						filter: (m) => m.user.id === ctx.author?.id,
						time: 120000, // Extended to 2 minutes
					})
					.then(async (m) => {

						const name = m.fields.getTextInputValue("name");
						const trigger = m.fields.getTextInputValue("trigger");
						const response = m.fields.getTextInputValue("response");
						const regex = m.fields.getTextInputValue("use_regex");
						let useRegex = false;

						if (regex?.toLowerCase() === "yes") {
							useRegex = true;
						}

						// Check if responder with this name already exists
						const responder = await AutoResponder.get(ctx.guild?.id, name);
						if (responder) {
							return await m.reply({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.red)
										.setDescription("<:Cross:1375519752746958858> A responder with this name already exists!")
										.addFields(
											{ name: "What to do", value: "Please choose a different name or edit the existing responder." }
										)
								],
								flags: MessageFlags.Ephemeral
							});
						}

						// Validate regex if used
						if (useRegex) {
							try {
								new RegExp(trigger);
							} catch (_error) {
								return m.reply({
									embeds: [
										new EmbedBuilder()
											.setColor(ctx.client.config.colors.red)
											.setDescription("<:Cross:1375519752746958858> Invalid regex pattern!")
											.addFields(
												{ name: "Error Details", value: "The regex pattern you provided is not valid. Please check your syntax and try again." }
											)
									],
									flags: MessageFlags.Ephemeral
								});
							}
						}

						// Create the autoresponder
						await AutoResponder.create({
							name: name,
							trigger: trigger,
							response: response,
							useRegex: useRegex,
							guildId: ctx.guild?.id,
							cooldown: 5,
							createdAt: new Date(),
							enabled: true,
						});

						return m.reply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.main)
									.setTitle("<:Tick:1375519268292264012> Responder Added")
									.setDescription(`Successfully created autoresponder: **${name}**`)
									.addFields(
										{ name: "Trigger", value: trigger },
										{ name: "Uses Regex", value: useRegex ? "Yes" : "No" },
										{ name: "Response", value: response.length > 100 ? `${response.substring(0, 100)}...` : response }
									)
							],
							flags: MessageFlags.Ephemeral
						});
					})
					.catch(() => {
						// Handle timeout
						i.followUp({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("<:Cross:1375519752746958858> Time expired! Please try again.")
							],
							flags: MessageFlags.Ephemeral
						});
					});
			} else if (i.customId === "auto_responder_remove") {
				// Get all responders for this guild
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(ctx.client.config.colors.red)
								.setDescription("<:Cross:1375519752746958858> No autoresponders found in this server!")
								.addFields(
									{ name: "Getting Started", value: "Click the 'Add Responder' button to create your first autoresponder." }
								)
						],
						flags: MessageFlags.Ephemeral
					});
				}

				// Create selection menu
				const menu = new StringSelectMenuBuilder()
					.setCustomId("auto_responder_remove_menu")
					.setPlaceholder("Select a responder to remove")
					.setMinValues(1)
					.setMaxValues(1);

				// Add options for each responder
				for (const r of responders) {
					menu.addOptions({
						label: r.name,
						description: `Trigger: ${r.trigger.length > 20 ? `${r.trigger.substring(0, 20)}...` : r.trigger}`,
						value: r.name,
						emoji: "🗑️",
					});
				}

				const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(menu);

				await i.reply({
					embeds: [
						new EmbedBuilder()
							.setColor(ctx.client.config.colors.main)
							.setTitle("🗑️ Remove Autoresponder")
							.setDescription("Select an autoresponder to remove from your server.")
					],
					components: [row],
					flags: MessageFlags.Ephemeral,
				});

				const message = await i.fetchReply();

				const menuCollector = message.createMessageComponentCollector({
					componentType: ComponentType.StringSelect,
					idle: 60000
				});

				menuCollector.on("collect", async (i) => {
					const responder = await AutoResponder.get(ctx.guild?.id, i.values[0]!);

					if (!responder) {
						return i.reply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("<:Cross:1375519752746958858> Responder not found!")
							],
							flags: MessageFlags.Ephemeral
						});
					}

					// Create confirmation buttons
					const confirmButton = new ButtonBuilder()
						.setCustomId("auto_responder_remove_confirm")
						.setLabel("Confirm Delete")
						.setStyle(ButtonStyle.Danger);

					const cancelButton = new ButtonBuilder()
						.setCustomId("auto_responder_remove_cancel")
						.setLabel("Cancel")
						.setStyle(ButtonStyle.Secondary);

					const confirmRow = new ActionRowBuilder<ButtonBuilder>()
						.addComponents(confirmButton, cancelButton);

					await i.update({
						embeds: [
							new EmbedBuilder()
								.setColor(ctx.client.config.colors.red)
								.setTitle("⚠️ Confirm Deletion")
								.setDescription(`Are you sure you want to remove the autoresponder **${responder.name}**?`)
								.addFields(
									{ name: "Trigger", value: responder.trigger },
									{ name: "Response", value: responder.response.length > 100 ? `${responder.response.substring(0, 100)}...` : responder.response }
								)
						],
						components: [confirmRow],
					});

					const confirmCollector = message.createMessageComponentCollector({
						componentType: ComponentType.Button,
						idle: 30000
					});

					confirmCollector.on("collect", async (btn) => {
						if (btn.customId === "auto_responder_remove_confirm") {
							await AutoResponder.delete(ctx.guild?.id, responder.name);

							await btn.update({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.main)
										.setDescription(`<:Tick:1375519268292264012> Autoresponder **${responder.name}** has been removed!`)
								],
								components: [],
							});
						} else if (btn.customId === "auto_responder_remove_cancel") {
							await btn.update({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.main)
										.setDescription("<:Cross:1375519752746958858> Deletion cancelled.")
								],
								components: [],
							});
						}

						confirmCollector.stop();
					});

					confirmCollector.on("end", async (collected, reason) => {
						if (reason === "idle" && collected.size === 0) {
							await i.editReply({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.red)
										.setDescription("⏱️ Time expired! Deletion cancelled.")
								],
								components: [],
							});
						}
					});
				});

				menuCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("⏱️ Time expired! Please try again.")
							],
							components: [],
						});
					}
				});
			} else if (i.customId === "auto_responder_clear") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(ctx.client.config.colors.red)
								.setDescription("<:Cross:1375519752746958858> No autoresponders found in this server!")
						],
						flags: MessageFlags.Ephemeral
					});
				}

				// Create confirmation buttons
				const confirmButton = new ButtonBuilder()
					.setCustomId("auto_responder_clear_confirm")
					.setLabel("Yes, Delete All")
					.setStyle(ButtonStyle.Danger);

				const cancelButton = new ButtonBuilder()
					.setCustomId("auto_responder_clear_cancel")
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Secondary);

				const confirmRow = new ActionRowBuilder<ButtonBuilder>()
					.addComponents(confirmButton, cancelButton);

				await i.reply({
					embeds: [
						new EmbedBuilder()
							.setColor(ctx.client.config.colors.red)
							.setTitle("⚠️ Clear All Autoresponders")
							.setDescription(`Are you sure you want to delete **ALL ${responders.length} autoresponders** from this server?`)
							.addFields(
								{ name: "Warning", value: "This action cannot be undone!" }
							)
					],
					components: [confirmRow],
					flags: MessageFlags.Ephemeral,
				});

				const message = await i.fetchReply();
				const clearCollector = message.createMessageComponentCollector({
					componentType: ComponentType.Button,
					idle: 30000
				});

				clearCollector.on("collect", async (btn) => {
					if (btn.customId === "auto_responder_clear_confirm") {
						const all = await AutoResponder.getAll(ctx.guild?.id);

						if (!all || all.length === 0) {
							return btn.update({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.red)
										.setDescription("<:Cross:1375519752746958858> No autoresponders found to delete!")
								],
								components: []
							});
						}

						for (const r of all) {
							await AutoResponder.delete(ctx.guild?.id, r.name);
						}

						return btn.update({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.main)
									.setDescription(`<:Tick:1375519268292264012> Successfully removed all ${all.length} autoresponders!`)
							],
							components: []
						});
					}

					if (btn.customId === "auto_responder_clear_cancel") {
						return btn.update({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.main)
									.setDescription("<:Cross:1375519752746958858> Operation cancelled.")
							],
							components: []
						});
					}
				});

				clearCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("⏱️ Time expired! Operation cancelled.")
							],
							components: [],
						});
					}
				});
			} else if (i.customId === "auto_responder_edit") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(ctx.client.config.colors.red)
								.setDescription("<:Cross:1375519752746958858> No autoresponders found in this server!")
								.addFields(
									{ name: "Getting Started", value: "Click the 'Add Responder' button to create your first autoresponder." }
								)
						],
						flags: MessageFlags.Ephemeral
					});
				}

				// Create selection menu
				const menu = new StringSelectMenuBuilder()
					.setCustomId("auto_responder_edit_menu")
					.setPlaceholder("Select a responder to edit")
					.setMinValues(1)
					.setMaxValues(1);

				// Add options for each responder
				for (const r of responders) {
					menu.addOptions({
						label: r.name,
						description: `Trigger: ${r.trigger.length > 20 ? `${r.trigger.substring(0, 20)}...` : r.trigger}`,
						value: r.name,
						emoji: "✏️",
					});
				}

				const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(menu);

				await i.reply({
					embeds: [
						new EmbedBuilder()
							.setColor(ctx.client.config.colors.main)
							.setTitle("✏️ Edit Autoresponder")
							.setDescription("Select an autoresponder to modify its settings.")
					],
					components: [row],
					flags: MessageFlags.Ephemeral,
				});

				const message = await i.fetchReply();

				const menuCollector = message.createMessageComponentCollector({
					componentType: ComponentType.StringSelect,
					idle: 60000
				});

				menuCollector.on("collect", async (i) => {
					const value = i.values[0];
					if (!value) return;

					const responder = await AutoResponder.get(ctx.guild?.id, value);

					if (!responder) {
						return i.reply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("<:Cross:1375519752746958858> Responder not found!")
							],
							flags: MessageFlags.Ephemeral
						});
					}

					// Create modal for editing
					const modal = new ModalBuilder()
						.setCustomId("auto_responder_edit_modal")
						.setTitle(`Edit Responder: ${responder.name}`);

					const nameInput = new TextInputBuilder()
						.setCustomId("name")
						.setLabel("Name (unique identifier)")
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setValue(responder.name);

					const triggerInput = new TextInputBuilder()
						.setCustomId("trigger")
						.setLabel("Trigger Word/Pattern")
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setValue(responder.trigger);

					const responseInput = new TextInputBuilder()
						.setCustomId("response")
						.setLabel("Response Message")
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setValue(responder.response);

					const regexInput = new TextInputBuilder()
						.setCustomId("use_regex")
						.setLabel("Use Regex? (yes/no)")
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setPlaceholder(responder.useRegex ? "Yes" : "No")
						.setValue(responder.useRegex ? "Yes" : "No");

					const row0 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
					const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(triggerInput);
					const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(responseInput);
					const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(regexInput);

					modal.addComponents(row0, row1, row2, row3);

					await i.showModal(modal);
					await i
						.awaitModalSubmit({
							filter: (m) => m.user.id === ctx.author?.id,
							time: 120000, // Extended to 2 minutes
						})
						.then(async (m) => {
							const name = m.fields.getTextInputValue("name");
							const trigger = m.fields.getTextInputValue("trigger");
							const response = m.fields.getTextInputValue("response");
							const regex = m.fields.getTextInputValue("use_regex");
							let useRegex = false;

							if (regex?.toLowerCase() === "yes") {
								useRegex = true;
							}

							// Validate regex if used
							if (useRegex) {
								try {
									new RegExp(trigger);
								} catch (_error) {
									return m.reply({
										embeds: [
											new EmbedBuilder()
												.setColor(ctx.client.config.colors.red)
												.setDescription("<:Cross:1375519752746958858> Invalid regex pattern!")
												.addFields(
													{ name: "Error Details", value: "The regex pattern you provided is not valid. Please check your syntax and try again." }
												)
										],
										flags: MessageFlags.Ephemeral
									});
								}
							}

							// If name changed, check if the new name already exists
							if (name !== responder.name) {
								const existingResponder = await AutoResponder.get(ctx.guild?.id, name);
								if (existingResponder) {
									return m.reply({
										embeds: [
											new EmbedBuilder()
												.setColor(ctx.client.config.colors.red)
												.setDescription("<:Cross:1375519752746958858> A responder with this name already exists!")
												.addFields(
													{ name: "What to do", value: "Please choose a different name or edit the existing responder." }
												)
										],
										flags: MessageFlags.Ephemeral
									});
								}

								// Delete the old responder and create a new one with the updated name
								await AutoResponder.delete(ctx.guild?.id, responder.name);
								await AutoResponder.create({
									name: name,
									trigger: trigger,
									response: response,
									useRegex: useRegex,
									guildId: ctx.guild?.id,
									cooldown: responder.cooldown,
									createdAt: responder.createdAt,
									enabled: responder.enabled,
								});
							} else {
								// Update the existing responder
								await AutoResponder.update(ctx.guild?.id, name, {
									trigger: trigger,
									response: response,
									useRegex: useRegex,
								});
							}

							return m.reply({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.main)
										.setTitle("<:Tick:1375519268292264012> Responder Updated")
										.setDescription(`Successfully updated autoresponder: **${name}**`)
										.addFields(
											{ name: "Trigger", value: trigger },
											{ name: "Uses Regex", value: useRegex ? "Yes" : "No" },
											{ name: "Response", value: response.length > 100 ? `${response.substring(0, 100)}...` : response }
										)
								],
								flags: MessageFlags.Ephemeral
							});
						})
						.catch(() => {
							// Handle timeout
							i.followUp({
								embeds: [
									new EmbedBuilder()
										.setColor(ctx.client.config.colors.red)
										.setDescription("⏱️ Time expired! Please try again.")
								],
								flags: MessageFlags.Ephemeral
							});
						});
				});

				menuCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.red)
									.setDescription("⏱️ Time expired! Please try again.")
							],
							components: [],
						});
					}
				});
			} else if (i.customId === "auto_responder_list") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(ctx.client.config.colors.red)
								.setDescription("<:Cross:1375519752746958858> No autoresponders found in this server!")
								.addFields(
									{ name: "Getting Started", value: "Click the 'Add Responder' button to create your first autoresponder." }
								)
						],
						flags: MessageFlags.Ephemeral
					});
				}

				// Create a detailed list of responders
				const embed = new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setTitle("📋 Autoresponder List")
					.setDescription(`This server has **${responders.length}** configured autoresponders.`);

				// Add responders as fields
				let count = 0;
				for (const r of responders) {
					count++;
					if (count <= 25) { // Discord has a 25 field limit
						embed.addFields({
							name: `${count}. ${r.name}`,
							value: `**Trigger**: ${r.trigger.length > 30 ? `${r.trigger.substring(0, 30)}...` : r.trigger}\n**Regex**: ${r.useRegex ? "Yes" : "No"}\n**Response**: ${r.response.length > 40 ? `${r.response.substring(0, 40)}...` : r.response}`
						});
					}
				}

				// If we have more than 25, note it
				if (count > 25) {
					embed.setFooter({
						text: `Showing 25/${count} responders. Use the Edit or Remove buttons to see more.`
					});
				}

				// Create a "back" button
				const backButton = new ButtonBuilder()
					.setCustomId("auto_responder_list_back")
					.setLabel("Back to Menu")
					.setStyle(ButtonStyle.Secondary);

				const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

				await i.reply({
					embeds: [embed],
					components: [backRow],
					flags: MessageFlags.Ephemeral
				});

				// Set up collector for the back button
				const message = await i.fetchReply();
				const backCollector = message.createMessageComponentCollector({
					componentType: ComponentType.Button,
					idle: 60000
				});

				backCollector.on("collect", async (btn) => {
					if (btn.customId === "auto_responder_list_back") {
						await btn.update({
							embeds: [
								new EmbedBuilder()
									.setColor(ctx.client.config.colors.main)
									.setDescription("Returning to main menu...")
							],
							components: [],
						});
					}
				});
			}
		});

		// Handle collector end
		collector.on("end", async () => {
			// Update the message to show the session has ended
			await msg.edit({
				components: [],
				embeds: [
					new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setTitle("🤖 Autoresponder Manager - Session Ended")
						.setDescription("This session has expired. Type `/autoresponder` or `!ar` to start a new session.")
				],
			}).catch(() => { });
		});
	}
}
