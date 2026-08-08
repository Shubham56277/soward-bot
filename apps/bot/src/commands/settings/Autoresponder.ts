import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AutoResponder } from "@repo/db";

const V2_FLAGS = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL_FLAGS = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** Build a components-only panel with an optional list of heading/content sections. */
function panel(title: string, description: string, sections: Array<[string, string]> = []): ContainerBuilder {
	const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
	for (const [heading, content] of sections) {
		container
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${heading}**\n${content}`));
	}
	return container;
}

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

	/** Build the main manager panel and its button rows. When disabled is true the buttons are inert. */
	private buildManager(disabled = false): { container: ContainerBuilder; rows: ActionRowBuilder<ButtonBuilder>[] } {
		const container = panel(
			"Autoresponder Manager",
			"Set up automatic responses to specific messages in your server.",
			[
				["How it works", "When a user types a trigger word or pattern, the bot automatically replies with your configured message."],
				["Getting started", "Use the buttons below to add, edit, view, or remove your autoresponders."],
			],
		);

		const addButton = new ButtonBuilder().setCustomId("auto_responder_open_modal").setLabel("Add Responder").setStyle(ButtonStyle.Primary).setDisabled(disabled);
		const editButton = new ButtonBuilder().setCustomId("auto_responder_edit").setLabel("Edit").setStyle(ButtonStyle.Secondary).setDisabled(disabled);
		const listButton = new ButtonBuilder().setCustomId("auto_responder_list").setLabel("View All").setStyle(ButtonStyle.Success).setDisabled(disabled);
		const removeButton = new ButtonBuilder().setCustomId("auto_responder_remove").setLabel("Remove").setStyle(ButtonStyle.Danger).setDisabled(disabled);
		const clearButton = new ButtonBuilder().setCustomId("auto_responder_clear").setLabel("Clear All").setStyle(ButtonStyle.Secondary).setDisabled(disabled);

		const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(addButton, editButton, listButton);
		const secondaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(removeButton, clearButton);

		return { container, rows: [primaryRow, secondaryRow] };
	}

	/** Build the responder details modal, optionally prefilled for editing. */
	private buildModal(customId: string, title: string, prefill?: { name: string; trigger: string; response: string; useRegex: boolean }): ModalBuilder {
		const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

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

		if (prefill) {
			nameInput.setValue(prefill.name);
			triggerInput.setValue(prefill.trigger);
			responseInput.setValue(prefill.response);
			regexInput.setValue(prefill.useRegex ? "Yes" : "No").setPlaceholder(prefill.useRegex ? "Yes" : "No");
		}

		modal.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
			new ActionRowBuilder<TextInputBuilder>().addComponents(triggerInput),
			new ActionRowBuilder<TextInputBuilder>().addComponents(responseInput),
			new ActionRowBuilder<TextInputBuilder>().addComponents(regexInput),
		);

		return modal;
	}

	public async run(ctx: Context): Promise<any> {
		const { container, rows } = this.buildManager();

		// Send the initial manager panel.
		const msg = await ctx.editOrReply({
			components: [container, ...rows],
			flags: V2_FLAGS,
		});

		// Only allow the command author to interact with the buttons.
		const filter = (i: any) => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({
				components: [panel("Permission required", "You do not have permission to use these controls.")],
				flags: V2_EPHEMERAL_FLAGS,
			}).catch(() => {});
			return false;
		};

		const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, filter, idle: 300000 });

		collector.on("collect", async (i) => {
			if (i.customId === "auto_responder_open_modal") {
				const modal = this.buildModal("auto_responder_modal", "Create New Auto Responder");

				await i.showModal(modal);
				await i
					.awaitModalSubmit({
						filter: (m) => m.user.id === ctx.author?.id,
						time: 120000,
					})
					.then(async (m) => {
						const name = m.fields.getTextInputValue("name");
						const trigger = m.fields.getTextInputValue("trigger");
						const response = m.fields.getTextInputValue("response");
						const regex = m.fields.getTextInputValue("use_regex");
						const useRegex = regex?.toLowerCase() === "yes";

						// Reject duplicate names.
						const responder = await AutoResponder.get(ctx.guild?.id, name);
						if (responder) {
							return m.reply({
								components: [panel("Name already in use", "A responder with this name already exists.", [["What to do", "Choose a different name or edit the existing responder."]])],
								flags: V2_EPHEMERAL_FLAGS,
							});
						}

						// Validate regex when requested.
						if (useRegex) {
							try {
								new RegExp(trigger);
							} catch (_error) {
								return m.reply({
									components: [panel("Invalid regex pattern", "The regex pattern you provided is not valid.", [["Error details", "Check your syntax and try again."]])],
									flags: V2_EPHEMERAL_FLAGS,
								});
							}
						}

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
							components: [
								panel("Responder added", `Successfully created autoresponder: **${name}**`, [
									["Trigger", trigger],
									["Uses regex", useRegex ? "Yes" : "No"],
									["Response", response.length > 100 ? `${response.substring(0, 100)}...` : response],
								]),
							],
							flags: V2_EPHEMERAL_FLAGS,
						});
					})
					.catch(() => {
						i.followUp({
							components: [panel("Time expired", "The form timed out. Please try again.")],
							flags: V2_EPHEMERAL_FLAGS,
						}).catch(() => {});
					});
			} else if (i.customId === "auto_responder_remove") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						components: [panel("No autoresponders", "No autoresponders found in this server.", [["Getting started", "Use the Add Responder button to create your first autoresponder."]])],
						flags: V2_EPHEMERAL_FLAGS,
					});
				}

				const menu = new StringSelectMenuBuilder()
					.setCustomId("auto_responder_remove_menu")
					.setPlaceholder("Select a responder to remove")
					.setMinValues(1)
					.setMaxValues(1);

				for (const r of responders) {
					menu.addOptions({
						label: r.name,
						description: `Trigger: ${r.trigger.length > 20 ? `${r.trigger.substring(0, 20)}...` : r.trigger}`,
						value: r.name,
					});
				}

				const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(menu);

				await i.reply({
					components: [panel("Remove autoresponder", "Select an autoresponder to remove from your server."), row],
					flags: V2_EPHEMERAL_FLAGS,
				});

				const message = await i.fetchReply();
				const menuCollector = message.createMessageComponentCollector({
					componentType: ComponentType.StringSelect,
					idle: 60000,
				});

				menuCollector.on("collect", async (select) => {
					const responder = await AutoResponder.get(ctx.guild?.id, select.values[0]!);

					if (!responder) {
						return select.reply({
							components: [panel("Not found", "That responder could not be found.")],
							flags: V2_EPHEMERAL_FLAGS,
						});
					}

					const confirmButton = new ButtonBuilder().setCustomId("auto_responder_remove_confirm").setLabel("Confirm Delete").setStyle(ButtonStyle.Danger);
					const cancelButton = new ButtonBuilder().setCustomId("auto_responder_remove_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary);
					const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

					await select.update({
						components: [
							panel("Confirm deletion", `Are you sure you want to remove the autoresponder **${responder.name}**?`, [
								["Trigger", responder.trigger],
								["Response", responder.response.length > 100 ? `${responder.response.substring(0, 100)}...` : responder.response],
							]),
							confirmRow,
						],
					});

					const confirmCollector = message.createMessageComponentCollector({
						componentType: ComponentType.Button,
						idle: 30000,
					});

					confirmCollector.on("collect", async (btn) => {
						if (btn.customId === "auto_responder_remove_confirm") {
							await AutoResponder.delete(ctx.guild?.id, responder.name);
							await btn.update({
								components: [panel("Responder removed", `Autoresponder **${responder.name}** has been removed.`)],
							});
						} else if (btn.customId === "auto_responder_remove_cancel") {
							await btn.update({
								components: [panel("Cancelled", "Deletion cancelled.")],
							});
						}

						confirmCollector.stop();
					});

					confirmCollector.on("end", async (collected, reason) => {
						if (reason === "idle" && collected.size === 0) {
							await select.editReply({
								components: [panel("Time expired", "Deletion cancelled.")],
							}).catch(() => {});
						}
					});
				});

				menuCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							components: [panel("Time expired", "Please try again.")],
						}).catch(() => {});
					}
				});
			} else if (i.customId === "auto_responder_clear") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						components: [panel("No autoresponders", "No autoresponders found in this server.")],
						flags: V2_EPHEMERAL_FLAGS,
					});
				}

				const confirmButton = new ButtonBuilder().setCustomId("auto_responder_clear_confirm").setLabel("Yes, Delete All").setStyle(ButtonStyle.Danger);
				const cancelButton = new ButtonBuilder().setCustomId("auto_responder_clear_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary);
				const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

				await i.reply({
					components: [
						panel("Clear all autoresponders", `Are you sure you want to delete all ${responders.length} autoresponders from this server?`, [["Warning", "This action cannot be undone."]]),
						confirmRow,
					],
					flags: V2_EPHEMERAL_FLAGS,
				});

				const message = await i.fetchReply();
				const clearCollector = message.createMessageComponentCollector({
					componentType: ComponentType.Button,
					idle: 30000,
				});

				clearCollector.on("collect", async (btn) => {
					if (btn.customId === "auto_responder_clear_confirm") {
						const all = await AutoResponder.getAll(ctx.guild?.id);

						if (!all || all.length === 0) {
							return btn.update({
								components: [panel("Nothing to delete", "No autoresponders found to delete.")],
							});
						}

						for (const r of all) {
							await AutoResponder.delete(ctx.guild?.id, r.name);
						}

						return btn.update({
							components: [panel("All cleared", `Successfully removed all ${all.length} autoresponders.`)],
						});
					}

					if (btn.customId === "auto_responder_clear_cancel") {
						return btn.update({
							components: [panel("Cancelled", "Operation cancelled.")],
						});
					}
				});

				clearCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							components: [panel("Time expired", "Operation cancelled.")],
						}).catch(() => {});
					}
				});
			} else if (i.customId === "auto_responder_edit") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						components: [panel("No autoresponders", "No autoresponders found in this server.", [["Getting started", "Use the Add Responder button to create your first autoresponder."]])],
						flags: V2_EPHEMERAL_FLAGS,
					});
				}

				const menu = new StringSelectMenuBuilder()
					.setCustomId("auto_responder_edit_menu")
					.setPlaceholder("Select a responder to edit")
					.setMinValues(1)
					.setMaxValues(1);

				for (const r of responders) {
					menu.addOptions({
						label: r.name,
						description: `Trigger: ${r.trigger.length > 20 ? `${r.trigger.substring(0, 20)}...` : r.trigger}`,
						value: r.name,
					});
				}

				const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(menu);

				await i.reply({
					components: [panel("Edit autoresponder", "Select an autoresponder to modify its settings."), row],
					flags: V2_EPHEMERAL_FLAGS,
				});

				const message = await i.fetchReply();
				const menuCollector = message.createMessageComponentCollector({
					componentType: ComponentType.StringSelect,
					idle: 60000,
				});

				menuCollector.on("collect", async (select) => {
					const value = select.values[0];
					if (!value) return;

					const responder = await AutoResponder.get(ctx.guild?.id, value);

					if (!responder) {
						return select.reply({
							components: [panel("Not found", "That responder could not be found.")],
							flags: V2_EPHEMERAL_FLAGS,
						});
					}

					const modal = this.buildModal("auto_responder_edit_modal", `Edit Responder: ${responder.name}`.slice(0, 45), {
						name: responder.name,
						trigger: responder.trigger,
						response: responder.response,
						useRegex: Boolean(responder.useRegex),
					});

					await select.showModal(modal);
					await select
						.awaitModalSubmit({
							filter: (m) => m.user.id === ctx.author?.id,
							time: 120000,
						})
						.then(async (m) => {
							const name = m.fields.getTextInputValue("name");
							const trigger = m.fields.getTextInputValue("trigger");
							const response = m.fields.getTextInputValue("response");
							const regex = m.fields.getTextInputValue("use_regex");
							const useRegex = regex?.toLowerCase() === "yes";

							// Validate regex when requested.
							if (useRegex) {
								try {
									new RegExp(trigger);
								} catch (_error) {
									return m.reply({
										components: [panel("Invalid regex pattern", "The regex pattern you provided is not valid.", [["Error details", "Check your syntax and try again."]])],
										flags: V2_EPHEMERAL_FLAGS,
									});
								}
							}

							// If the name changed, ensure the new name is free, then delete + recreate.
							if (name !== responder.name) {
								const existingResponder = await AutoResponder.get(ctx.guild?.id, name);
								if (existingResponder) {
									return m.reply({
										components: [panel("Name already in use", "A responder with this name already exists.", [["What to do", "Choose a different name or edit the existing responder."]])],
										flags: V2_EPHEMERAL_FLAGS,
									});
								}

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
								await AutoResponder.update(ctx.guild?.id, name, {
									trigger: trigger,
									response: response,
									useRegex: useRegex,
								});
							}

							return m.reply({
								components: [
									panel("Responder updated", `Successfully updated autoresponder: **${name}**`, [
										["Trigger", trigger],
										["Uses regex", useRegex ? "Yes" : "No"],
										["Response", response.length > 100 ? `${response.substring(0, 100)}...` : response],
									]),
								],
								flags: V2_EPHEMERAL_FLAGS,
							});
						})
						.catch(() => {
							select.followUp({
								components: [panel("Time expired", "The form timed out. Please try again.")],
								flags: V2_EPHEMERAL_FLAGS,
							}).catch(() => {});
						});
				});

				menuCollector.on("end", async (collected, reason) => {
					if (reason === "idle" && collected.size === 0) {
						await i.editReply({
							components: [panel("Time expired", "Please try again.")],
						}).catch(() => {});
					}
				});
			} else if (i.customId === "auto_responder_list") {
				const responders = await AutoResponder.getAll(ctx.guild?.id);

				if (!responders || responders.length === 0) {
					return i.reply({
						components: [panel("No autoresponders", "No autoresponders found in this server.", [["Getting started", "Use the Add Responder button to create your first autoresponder."]])],
						flags: V2_EPHEMERAL_FLAGS,
					});
				}

				const MAX_LISTED = 25;
				const shown = responders.slice(0, MAX_LISTED);
				const sections: Array<[string, string]> = shown.map((r, index) => {
					const trigger = r.trigger.length > 30 ? `${r.trigger.substring(0, 30)}...` : r.trigger;
					const response = r.response.length > 40 ? `${r.response.substring(0, 40)}...` : r.response;
					return [`${index + 1}. ${r.name}`, `Trigger: ${trigger}\nRegex: ${r.useRegex ? "Yes" : "No"}\nResponse: ${response}`];
				});

				let description = `This server has **${responders.length}** configured autoresponders.`;
				if (responders.length > MAX_LISTED) {
					description += `\nShowing ${MAX_LISTED} of ${responders.length}. Use Edit or Remove to manage the rest.`;
				}

				await i.reply({
					components: [panel("Autoresponder list", description, sections)],
					flags: V2_EPHEMERAL_FLAGS,
				});
			}
		});

		// When the session ends, replace the controls with a components-only notice.
		collector.on("end", async () => {
			await msg
				.edit({
					components: [panel("Autoresponder Manager", "This session has ended. Run the autoresponder command again to start a new session.")],
					flags: V2_FLAGS,
				})
				.catch(() => {});
		});
	}
}
