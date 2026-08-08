import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	ComponentType,
	ContainerBuilder,
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
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { TicketConfig } from "@repo/db";

const TICKET_V2_FLAGS = MessageFlags.IsComponentsV2;

interface PanelOptions {
	title: string;
	description: string;
	buttonLabel: string;
	buttonStyle: ButtonStyle;
}

export default class TicketCommand extends Command {
	constructor() {
		super({
			name: "ticket",
			description: {
				content: "Create and manage support ticket systems.",
				examples: ["ticket setup", "ticket edit #panel", "ticket delete #panel", "ticket info #panel", "ticket list"],
				usage: "ticket [setup|edit|delete|info|list]",
			},
			category: "ticket",
			aliases: ["tickets", "support"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "ManageChannels", "ManageRoles"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [
				{
					name: "setup",
					description: "Open the ticket setup window",
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
							// @ts-expect-error channelTypes narrows to text channels
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
							// @ts-expect-error channelTypes narrows to text channels
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
							// @ts-expect-error channelTypes narrows to text channels
							channelTypes: [0],
							required: true,
						},
					],
				},
				{
					name: "list",
					description: "List all ticket systems",
					type: 1,
				},
			],
		});
	}

	// ─── Reusable Components V2 builders ────────────────────────────────────

	/** A plain informational container used for command responses. */
	private infoPanel(title: string, description: string, sections: Array<[string, string]> = [], footer?: string): ContainerBuilder {
		const panel = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
		for (const [heading, content] of sections) {
			panel
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${heading}**\n${content}`));
		}
		if (footer) {
			panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
		}
		return panel;
	}

	/** The live ticket panel posted to a guild channel, with the create button embedded. */
	private buildLivePanel(guildName: string, options: PanelOptions): ContainerBuilder {
		return new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${options.title}`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(options.description))
			.addActionRowComponents(
				new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("create_ticket").setLabel(options.buttonLabel).setStyle(options.buttonStyle)),
			)
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${guildName} · Ticket System`));
	}

	/** Extract the current panel options from a fetched Components V2 message. */
	private extractPanel(message: any): PanelOptions {
		const result: PanelOptions = {
			title: "Need Help?",
			description: "Click the button below to create a ticket.",
			buttonLabel: "Create Ticket",
			buttonStyle: ButtonStyle.Primary,
		};
		try {
			const texts: string[] = [];
			let button: any = null;
			const walk = (component: any) => {
				if (!component) return;
				if (component.type === ComponentType.TextDisplay && typeof component.content === "string") texts.push(component.content);
				if (component.type === ComponentType.Button && component.customId === "create_ticket") button = component;
				if (Array.isArray(component.components)) for (const child of component.components) walk(child);
			};
			for (const top of message.components ?? []) walk(top);

			const titleText = texts.find((text) => text.startsWith("## "));
			if (titleText) result.title = titleText.replace(/^##\s*/, "").trim();
			const descriptionText = texts.find((text) => !text.startsWith("## ") && !text.startsWith("-#"));
			if (descriptionText) result.description = descriptionText.trim();
			if (button) {
				if (button.label) result.buttonLabel = button.label;
				if (typeof button.style === "number") result.buttonStyle = button.style;
			}
		} catch {}
		return result;
	}

	private styleFromString(value: string): ButtonStyle {
		switch (value.trim().toLowerCase()) {
			case "secondary":
				return ButtonStyle.Secondary;
			case "success":
				return ButtonStyle.Success;
			case "danger":
				return ButtonStyle.Danger;
			default:
				return ButtonStyle.Primary;
		}
	}

	private authorFilter(ctx: Context) {
		return (interaction: any) => {
			if (interaction.user.id !== ctx.author?.id) {
				interaction
					.reply({
						content: "This ticket menu is not for you. Run the command yourself to use it.",
						flags: MessageFlags.Ephemeral,
					})
					.catch(() => {});
				return false;
			}
			return true;
		};
	}

	// ─── Entry point ────────────────────────────────────────────────────────

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand(false, 0);

		if (!subcommand) {
			return this.showDashboard(ctx);
		}

		switch (subcommand) {
			case "setup":
				return this.startSetup(ctx);
			case "delete":
				return this.handleDelete(ctx);
			case "edit":
				return this.handleEdit(ctx);
			case "info":
				return this.handleInfo(ctx);
			case "list":
				return this.handleList(ctx);
			default:
				return this.showDashboard(ctx);
		}
	}

	private async showDashboard(ctx: Context): Promise<any> {
		const panel = this.infoPanel(
			"Ticket System",
			"Manage support tickets with the subcommands below.",
			[
				["setup", "Open the interactive setup window to create a ticket panel."],
				["edit", "Edit an existing ticket panel, button, roles, or logging."],
				["delete", "Remove a ticket system from a channel."],
				["info", "View the configuration of a ticket system."],
				["list", "List every ticket system in this server."],
			],
			"Use ticket setup to get started",
		);
		return ctx.editOrReply({ components: [panel], flags: TICKET_V2_FLAGS });
	}

	// ─── Setup wizard ─────────────────────────────────────────────────────────

	private async startSetup(ctx: Context): Promise<any> {
		const panel = this.infoPanel("Ticket Setup", "Choose how you would like to set up your ticket system.", [
			["Quick Setup", "Create a ready-to-use ticket panel instantly."],
			["Advanced Setup", "Configure the category, channel, panel, button, and roles step by step."],
			["Templates", "Start from a pre-made ticket layout."],
		]);

		const choices = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("auto_setup").setLabel("Quick Setup").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("manual_setup").setLabel("Advanced Setup").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId("template_setup").setLabel("Templates").setStyle(ButtonStyle.Success),
		);

		const message = await ctx.editOrReply({ components: [panel, choices], flags: TICKET_V2_FLAGS });

		const collector = message.createMessageComponentCollector({
			filter: this.authorFilter(ctx),
			componentType: ComponentType.Button,
			time: 120_000,
		});

		collector.on("collect", async (interaction) => {
			try {
				if (interaction.customId === "auto_setup") {
					collector.stop();
					await interaction.deferUpdate();
					await this.setupTicketSystem(ctx, interaction, {
						title: "Need Help?",
						description: "Click the button below to create a ticket. Our support team will assist you as soon as possible.",
						buttonLabel: "Create Ticket",
						buttonStyle: ButtonStyle.Primary,
					});
				} else if (interaction.customId === "template_setup") {
					collector.stop();
					await this.handleTemplateSetup(ctx, interaction);
				} else if (interaction.customId === "manual_setup") {
					collector.stop();
					await this.startManualSetup(ctx, interaction);
				}
			} catch {}
		});

		collector.on("end", async (collected, reason) => {
			if (reason === "time" && collected.size === 0) {
				await message
					.edit({
						components: [this.infoPanel("Setup Closed", "The ticket setup window timed out. Run the command again to continue.")],
						flags: TICKET_V2_FLAGS,
					})
					.catch(() => {});
			}
		});
	}

	private templateOptions(template: string): PanelOptions {
		switch (template) {
			case "application":
				return { title: "Staff Applications", description: "Want to join our team? Open a ticket to start your application.", buttonLabel: "Apply Now", buttonStyle: ButtonStyle.Success };
			case "bug":
				return { title: "Report a Bug", description: "Found a bug? Open a ticket to report it to our team.", buttonLabel: "Report Bug", buttonStyle: ButtonStyle.Danger };
			case "feedback":
				return { title: "Share Your Feedback", description: "We value your opinion. Open a ticket to share your feedback with us.", buttonLabel: "Give Feedback", buttonStyle: ButtonStyle.Secondary };
			default:
				return { title: "Need Support?", description: "If you need assistance from our team, open a support ticket below.", buttonLabel: "Open Support Ticket", buttonStyle: ButtonStyle.Primary };
		}
	}

	private async handleTemplateSetup(ctx: Context, interaction: any): Promise<any> {
		const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("template_select")
				.setPlaceholder("Select a template")
				.addOptions(
					{ label: "Support Ticket", value: "support", description: "General support ticket system" },
					{ label: "Application System", value: "application", description: "Staff application ticket system" },
					{ label: "Bug Report", value: "bug", description: "Bug report ticket system" },
					{ label: "Feedback System", value: "feedback", description: "User feedback ticket system" },
				),
		);

		await interaction.update({
			components: [this.infoPanel("Template Selection", "Choose a pre-made template for your ticket system."), select],
			flags: TICKET_V2_FLAGS,
		});

		const selection = await interaction.message
			.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.StringSelect, time: 60_000 })
			.catch(() => null);
		if (!selection) {
			return;
		}
		await selection.deferUpdate();
		await this.setupTicketSystem(ctx, selection, this.templateOptions(selection.values[0]));
	}

	/** Create the category, channel, live panel, and DB config, then present optional configuration. */
	private async setupTicketSystem(ctx: Context, interaction: any, options: PanelOptions): Promise<any> {
		try {
			const category = await ctx.guild.channels.create({
				name: "Tickets",
				type: ChannelType.GuildCategory,
			});

			const channel = await ctx.guild.channels.create({
				name: "ticket-panel",
				type: ChannelType.GuildText,
				parent: category.id,
			});

			const panelMessage = await channel.send({
				components: [this.buildLivePanel(ctx.guild.name, options)],
				flags: TICKET_V2_FLAGS,
			});

			const ticketConfig = await TicketConfig.create({
				guildId: ctx.guild.id,
				channelId: channel.id,
				categoryId: category.id,
				openCategoryId: category.id,
				openLimit: 1,
				messageId: panelMessage.id,
				supportRoles: [],
				loggerChannelId: null,
			});

			if (!ticketConfig) {
				return interaction.editReply({
					components: [this.infoPanel("Setup Failed", "The ticket configuration could not be saved. Please try again.")],
					flags: TICKET_V2_FLAGS,
				});
			}

			const successPanel = this.infoPanel(
				"Ticket System Created",
				"Your ticket system is ready. You can configure optional settings below.",
				[
					["Panel Channel", `<#${channel.id}>`],
					["Category", `<#${category.id}>`],
				],
				"Select an option below or visit the panel channel",
			);

			const configureSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("configure_select")
					.setPlaceholder("Configure optional settings")
					.addOptions(
						{ label: "Add Support Roles", value: "add_role", description: "Roles that can manage tickets" },
						{ label: "Add Logger Channel", value: "add_logger", description: "Channel for ticket logs" },
						{ label: "Set Open Limit", value: "add_open_limit", description: "Maximum open tickets per user" },
					),
			);
			const visitRow = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Visit Channel").setStyle(ButtonStyle.Link).setURL(panelMessage.url));

			await interaction.editReply({ components: [successPanel, configureSelect, visitRow], flags: TICKET_V2_FLAGS });

			const reply = await interaction.fetchReply();
			const selection = await reply
				.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.StringSelect, time: 120_000 })
				.catch(() => null);
			if (!selection) {
				return;
			}
			switch (selection.values[0]) {
				case "add_role":
					return this.handleAddRole(ctx, selection, ticketConfig);
				case "add_logger":
					return this.handleAddLogger(ctx, selection, ticketConfig);
				case "add_open_limit":
					return this.handleOpenLimit(ctx, selection, ticketConfig);
			}
		} catch {
			await interaction
				.editReply({
					components: [this.infoPanel("Setup Failed", "Something went wrong while creating the ticket system. Check my permissions and try again.")],
					flags: TICKET_V2_FLAGS,
				})
				.catch(() => {});
		}
	}

	// ─── Advanced (manual) setup ────────────────────────────────────────────

	private async startManualSetup(ctx: Context, interaction: any): Promise<any> {
		const data = {
			step: 1,
			category: null as string | null,
			channel: null as string | null,
			title: "Need Help?",
			description: "Click the button below to create a ticket.",
			buttonLabel: "Create Ticket",
			buttonStyle: ButtonStyle.Primary as ButtonStyle,
			supportRoles: [] as string[],
			openLimit: 1,
			loggerChannel: null as string | null,
		};

		await interaction.update(this.renderManualStep(data));
		const message = interaction.message;

		const collector = message.createMessageComponentCollector({
			filter: this.authorFilter(ctx),
			time: 300_000,
		});

		collector.on("collect", async (i: any) => {
			try {
				const done = await this.handleManualInteraction(ctx, i, data);
				if (done) collector.stop();
			} catch {}
		});

		collector.on("end", async (_collected: any, reason: string) => {
			if (reason === "time") {
				await message
					.edit({
						components: [this.infoPanel("Setup Timed Out", "The setup window expired. Run the command again to continue.")],
						flags: TICKET_V2_FLAGS,
					})
					.catch(() => {});
			}
		});
	}

	private renderManualStep(data: any): { components: any[]; flags: number } {
		const steps = ["Category", "Channel", "Panel Text", "Button", "Extra Settings", "Confirm"];
		const progress = steps.map((label, index) => (index + 1 === data.step ? `**${index + 1}. ${label}**` : `${index + 1}. ${label}`)).join("  ·  ");

		switch (data.step) {
			case 1: {
				const panel = this.infoPanel("Advanced Setup", "Select a category for ticket channels, or skip to create a new one.", [["Progress", progress]]);
				const select = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
					new ChannelSelectMenuBuilder().setCustomId("setup_category_select").setPlaceholder("Select a category (optional)").setChannelTypes([ChannelType.GuildCategory]).setMinValues(0).setMaxValues(1),
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("skip_category").setLabel("Create New Category").setStyle(ButtonStyle.Secondary),
					new ButtonBuilder().setCustomId("cancel_setup").setLabel("Cancel").setStyle(ButtonStyle.Danger),
				);
				return { components: [panel, select, buttons], flags: TICKET_V2_FLAGS };
			}
			case 2: {
				const panel = this.infoPanel("Advanced Setup", "Select the channel where the ticket panel will be posted.", [
					["Category", data.category ? `<#${data.category}>` : "A new category will be created"],
					["Progress", progress],
				]);
				const select = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
					new ChannelSelectMenuBuilder().setCustomId("setup_channel_select").setPlaceholder("Select a channel").setChannelTypes([ChannelType.GuildText]).setMinValues(1).setMaxValues(1),
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
					new ButtonBuilder().setCustomId("cancel_setup").setLabel("Cancel").setStyle(ButtonStyle.Danger),
				);
				return { components: [panel, select, buttons], flags: TICKET_V2_FLAGS };
			}
			case 3: {
				const panel = this.infoPanel(
					"Advanced Setup",
					"Set the panel title and description, or keep the defaults.",
					[
						["Title", data.title],
						["Description", data.description],
						["Progress", progress],
					],
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("customize_embed_modal").setLabel("Edit Panel Text").setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId("skip_embed").setLabel("Keep Default").setStyle(ButtonStyle.Secondary),
					new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
				);
				return { components: [panel, buttons], flags: TICKET_V2_FLAGS };
			}
			case 4: {
				const panel = this.infoPanel(
					"Advanced Setup",
					"Customize the ticket button, or keep the defaults.",
					[
						["Label", data.buttonLabel],
						["Style", ButtonStyle[data.buttonStyle] ?? "Primary"],
						["Progress", progress],
					],
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("customize_button_modal").setLabel("Edit Button").setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId("skip_button").setLabel("Keep Default").setStyle(ButtonStyle.Secondary),
					new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
				);
				return { components: [panel, buttons], flags: TICKET_V2_FLAGS };
			}
			case 5: {
				const panel = this.infoPanel(
					"Advanced Setup",
					"Configure optional settings, or skip to the final step.",
					[
						["Support Roles", data.supportRoles.length ? data.supportRoles.map((role: string) => `<@&${role}>`).join(", ") : "None"],
						["Open Limit", String(data.openLimit)],
						["Logger Channel", data.loggerChannel ? `<#${data.loggerChannel}>` : "None"],
						["Progress", progress],
					],
				);
				const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId("additional_settings_select")
						.setPlaceholder("Configure optional settings")
						.addOptions(
							{ label: "Add Support Roles", value: "add_support_roles", description: "Roles that can manage tickets" },
							{ label: "Set Open Limit", value: "set_open_limit", description: "Maximum tickets per user" },
							{ label: "Add Logger Channel", value: "add_logger_channel", description: "Channel for ticket logs" },
						),
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("skip_additional").setLabel("Continue").setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
				);
				return { components: [panel, select, buttons], flags: TICKET_V2_FLAGS };
			}
			default: {
				const panel = this.infoPanel(
					"Advanced Setup",
					"Review the summary and create your ticket system.",
					[
						["Category", data.category ? `<#${data.category}>` : "A new category will be created"],
						["Channel", `<#${data.channel}>`],
						["Title", data.title],
						["Description", data.description],
						["Button", `${data.buttonLabel} (${ButtonStyle[data.buttonStyle] ?? "Primary"})`],
						["Support Roles", data.supportRoles.length ? data.supportRoles.map((role: string) => `<@&${role}>`).join(", ") : "None"],
						["Open Limit", String(data.openLimit)],
						["Logger Channel", data.loggerChannel ? `<#${data.loggerChannel}>` : "None"],
					],
				);
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("create_system").setLabel("Create Ticket System").setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Secondary),
					new ButtonBuilder().setCustomId("cancel_setup").setLabel("Cancel").setStyle(ButtonStyle.Danger),
				);
				return { components: [panel, buttons], flags: TICKET_V2_FLAGS };
			}
		}
	}

	/** Returns true when the wizard is finished and the collector should stop. */
	private async handleManualInteraction(ctx: Context, interaction: any, data: any): Promise<boolean> {
		switch (interaction.customId) {
			case "setup_category_select": {
				data.category = interaction.values?.[0] ?? null;
				data.step = 2;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "skip_category": {
				data.category = null;
				data.step = 2;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "setup_channel_select": {
				data.channel = interaction.values[0];
				data.step = 3;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "setup_back": {
				if (data.step > 1) data.step -= 1;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "skip_embed": {
				data.step = 4;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "skip_button": {
				data.step = 5;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "skip_additional": {
				data.step = 6;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "customize_embed_modal": {
				const modal = new ModalBuilder()
					.setCustomId("embed_customization_modal")
					.setTitle("Edit Panel Text")
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("embed_title").setLabel("Panel Title").setStyle(TextInputStyle.Short).setValue(data.title).setMaxLength(256).setRequired(true),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("embed_description").setLabel("Panel Description").setStyle(TextInputStyle.Paragraph).setValue(data.description).setMaxLength(2000).setRequired(true),
						),
					);
				await interaction.showModal(modal);
				const submit = await interaction.awaitModalSubmit({ time: 300_000, filter: (i: any) => i.customId === "embed_customization_modal" && i.user.id === ctx.author?.id }).catch(() => null);
				if (submit) {
					data.title = submit.fields.getTextInputValue("embed_title");
					data.description = submit.fields.getTextInputValue("embed_description");
					data.step = 4;
					await submit.update(this.renderManualStep(data));
				}
				return false;
			}
			case "customize_button_modal": {
				const modal = new ModalBuilder()
					.setCustomId("button_customization_modal")
					.setTitle("Edit Button")
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("button_label").setLabel("Button Label").setStyle(TextInputStyle.Short).setValue(data.buttonLabel).setMaxLength(80).setRequired(true),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId("button_style")
								.setLabel("Style: primary, secondary, success, danger")
								.setStyle(TextInputStyle.Short)
								.setValue((ButtonStyle[data.buttonStyle] ?? "Primary").toLowerCase())
								.setMaxLength(20)
								.setRequired(true),
						),
					);
				await interaction.showModal(modal);
				const submit = await interaction.awaitModalSubmit({ time: 300_000, filter: (i: any) => i.customId === "button_customization_modal" && i.user.id === ctx.author?.id }).catch(() => null);
				if (submit) {
					data.buttonLabel = submit.fields.getTextInputValue("button_label");
					data.buttonStyle = this.styleFromString(submit.fields.getTextInputValue("button_style"));
					data.step = 5;
					await submit.update(this.renderManualStep(data));
				}
				return false;
			}
			case "additional_settings_select": {
				const value = interaction.values[0];
				if (value === "add_support_roles") {
					const select = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
						new RoleSelectMenuBuilder().setCustomId("support_roles_select").setPlaceholder("Select support roles").setMinValues(1).setMaxValues(10),
					);
					const back = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("back_to_additional").setLabel("Back").setStyle(ButtonStyle.Secondary));
					await interaction.update({ components: [this.infoPanel("Support Roles", "Select the roles that can manage tickets."), select, back], flags: TICKET_V2_FLAGS });
				} else if (value === "add_logger_channel") {
					const select = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
						new ChannelSelectMenuBuilder().setCustomId("logger_channel_select").setPlaceholder("Select a logger channel").setChannelTypes([ChannelType.GuildText]).setMinValues(1).setMaxValues(1),
					);
					const back = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("back_to_additional").setLabel("Back").setStyle(ButtonStyle.Secondary));
					await interaction.update({ components: [this.infoPanel("Logger Channel", "Select a channel where ticket logs will be sent."), select, back], flags: TICKET_V2_FLAGS });
				} else if (value === "set_open_limit") {
					const modal = new ModalBuilder()
						.setCustomId("open_limit_modal")
						.setTitle("Set Open Ticket Limit")
						.addComponents(
							new ActionRowBuilder<TextInputBuilder>().addComponents(
								new TextInputBuilder().setCustomId("open_limit").setLabel("Maximum tickets per user (1-10)").setStyle(TextInputStyle.Short).setValue(String(data.openLimit)).setMaxLength(2).setRequired(true),
							),
						);
					await interaction.showModal(modal);
					const submit = await interaction.awaitModalSubmit({ time: 120_000, filter: (i: any) => i.customId === "open_limit_modal" && i.user.id === ctx.author?.id }).catch(() => null);
					if (submit) {
						const limit = Number.parseInt(submit.fields.getTextInputValue("open_limit"), 10);
						if (Number.isFinite(limit) && limit >= 1 && limit <= 10) data.openLimit = limit;
						data.step = 5;
						await submit.update(this.renderManualStep(data));
					}
				}
				return false;
			}
			case "support_roles_select": {
				data.supportRoles = interaction.values;
				data.step = 5;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "logger_channel_select": {
				data.loggerChannel = interaction.values[0];
				data.step = 5;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "back_to_additional": {
				data.step = 5;
				await interaction.update(this.renderManualStep(data));
				return false;
			}
			case "cancel_setup": {
				await interaction.update({ components: [this.infoPanel("Setup Cancelled", "The ticket setup was cancelled.")], flags: TICKET_V2_FLAGS });
				return true;
			}
			case "create_system": {
				await this.createTicketSystemFromWizard(ctx, interaction, data);
				return true;
			}
			default:
				return false;
		}
	}

	private async createTicketSystemFromWizard(ctx: Context, interaction: any, data: any): Promise<any> {
		await interaction.deferUpdate();
		try {
			let categoryId = data.category as string | null;
			if (!categoryId) {
				const category = await ctx.guild.channels.create({ name: "Tickets", type: ChannelType.GuildCategory });
				categoryId = category.id;
			}

			const channel = ctx.guild.channels.cache.get(data.channel) as TextChannel;
			if (!channel) {
				return interaction.editReply({ components: [this.infoPanel("Setup Failed", "The selected channel no longer exists. Please run setup again.")], flags: TICKET_V2_FLAGS });
			}

			const panelMessage = await channel.send({
				components: [this.buildLivePanel(ctx.guild.name, { title: data.title, description: data.description, buttonLabel: data.buttonLabel, buttonStyle: data.buttonStyle })],
				flags: TICKET_V2_FLAGS,
			});

			await TicketConfig.create({
				guildId: ctx.guild.id,
				channelId: channel.id,
				categoryId: categoryId,
				openCategoryId: categoryId,
				supportRoles: data.supportRoles,
				openLimit: data.openLimit,
				loggerChannelId: data.loggerChannel,
				messageId: panelMessage.id,
			});

			await interaction.editReply({
				components: [
					this.infoPanel(
						"Ticket System Created",
						"Your ticket system is now active. Users can create tickets from the panel.",
						[
							["Panel Channel", `<#${channel.id}>`],
							["Support Roles", data.supportRoles.length ? data.supportRoles.map((role: string) => `<@&${role}>`).join(", ") : "None"],
							["Open Limit", String(data.openLimit)],
							["Logger Channel", data.loggerChannel ? `<#${data.loggerChannel}>` : "None"],
						],
						`View the panel in #${channel.name}`,
					),
				],
				flags: TICKET_V2_FLAGS,
			});
		} catch {
			await interaction
				.editReply({ components: [this.infoPanel("Setup Failed", "Something went wrong while creating the ticket system. Check my permissions and try again.")], flags: TICKET_V2_FLAGS })
				.catch(() => {});
		}
	}

	// ─── Optional configuration handlers (shared by setup + edit) ───────────

	private async handleAddRole(ctx: Context, interaction: any, config: TicketConfig): Promise<any> {
		const select = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
			new RoleSelectMenuBuilder().setCustomId("support_roles_select").setPlaceholder("Select support roles").setMinValues(1).setMaxValues(10),
		);
		await interaction.update({ components: [this.infoPanel("Add Support Roles", "Select the roles that can manage tickets."), select], flags: TICKET_V2_FLAGS });

		const selection = await interaction.message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.RoleSelect, time: 60_000 }).catch(() => null);
		if (!selection) return;
		await selection.deferUpdate();
		await TicketConfig.update(config.id, { supportRoles: selection.values });
		await selection.editReply({
			components: [this.infoPanel("Support Roles Updated", `Support roles set to ${selection.values.map((role: string) => `<@&${role}>`).join(", ")}.`)],
			flags: TICKET_V2_FLAGS,
		});
	}

	private async handleAddLogger(ctx: Context, interaction: any, config: TicketConfig): Promise<any> {
		const select = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
			new ChannelSelectMenuBuilder().setCustomId("logger_channel_select").setPlaceholder("Select a logger channel").setChannelTypes([ChannelType.GuildText]).setMinValues(1).setMaxValues(1),
		);
		await interaction.update({ components: [this.infoPanel("Add Logger Channel", "Select a channel where ticket logs will be sent."), select], flags: TICKET_V2_FLAGS });

		const selection = await interaction.message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.ChannelSelect, time: 60_000 }).catch(() => null);
		if (!selection) return;
		await selection.deferUpdate();
		await TicketConfig.update(config.id, { loggerChannelId: selection.values[0] });
		await selection.editReply({
			components: [this.infoPanel("Logger Channel Updated", `Ticket logs will be sent to <#${selection.values[0]}>.`)],
			flags: TICKET_V2_FLAGS,
		});
	}

	private async handleOpenLimit(ctx: Context, interaction: any, config: TicketConfig): Promise<any> {
		const modal = new ModalBuilder()
			.setCustomId("open_limit_modal")
			.setTitle("Set Open Ticket Limit")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("open_limit").setLabel("Maximum tickets per user (1-10)").setStyle(TextInputStyle.Short).setValue(String(config.openLimit)).setMaxLength(2).setRequired(true),
				),
			);
		await interaction.showModal(modal);
		const submit = await interaction.awaitModalSubmit({ time: 120_000, filter: (i: any) => i.customId === "open_limit_modal" && i.user.id === ctx.author?.id }).catch(() => null);
		if (!submit) return;
		const limit = Number.parseInt(submit.fields.getTextInputValue("open_limit"), 10);
		if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
			return submit.reply({ content: "Please enter a number between 1 and 10.", flags: MessageFlags.Ephemeral });
		}
		await TicketConfig.update(config.id, { openLimit: limit });
		await submit.update({ components: [this.infoPanel("Open Limit Updated", `Users can now have up to **${limit}** open ticket${limit === 1 ? "" : "s"}.`)], flags: TICKET_V2_FLAGS });
	}

	private async handleEditPanelText(ctx: Context, interaction: any, message: any): Promise<any> {
		const current = this.extractPanel(message);
		const modal = new ModalBuilder()
			.setCustomId("edit_panel_text_modal")
			.setTitle("Edit Panel Text")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("panel_title").setLabel("Panel Title").setStyle(TextInputStyle.Short).setValue(current.title).setMaxLength(256).setRequired(true),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("panel_description").setLabel("Panel Description").setStyle(TextInputStyle.Paragraph).setValue(current.description).setMaxLength(2000).setRequired(true),
				),
			);
		await interaction.showModal(modal);
		const submit = await interaction.awaitModalSubmit({ time: 300_000, filter: (i: any) => i.customId === "edit_panel_text_modal" && i.user.id === ctx.author?.id }).catch(() => null);
		if (!submit) return;
		const updated: PanelOptions = { ...current, title: submit.fields.getTextInputValue("panel_title"), description: submit.fields.getTextInputValue("panel_description") };
		await message.edit({ components: [this.buildLivePanel(ctx.guild.name, updated)], flags: TICKET_V2_FLAGS }).catch(() => {});
		await submit.update({ components: [this.infoPanel("Panel Updated", "The ticket panel text has been updated.")], flags: TICKET_V2_FLAGS });
	}

	private async handleEditButton(ctx: Context, interaction: any, message: any): Promise<any> {
		const current = this.extractPanel(message);
		const modal = new ModalBuilder()
			.setCustomId("edit_button_modal")
			.setTitle("Edit Button")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("button_label").setLabel("Button Label").setStyle(TextInputStyle.Short).setValue(current.buttonLabel).setMaxLength(80).setRequired(true),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("button_style")
						.setLabel("Style: primary, secondary, success, danger")
						.setStyle(TextInputStyle.Short)
						.setValue((ButtonStyle[current.buttonStyle] ?? "Primary").toLowerCase())
						.setMaxLength(20)
						.setRequired(true),
				),
			);
		await interaction.showModal(modal);
		const submit = await interaction.awaitModalSubmit({ time: 300_000, filter: (i: any) => i.customId === "edit_button_modal" && i.user.id === ctx.author?.id }).catch(() => null);
		if (!submit) return;
		const updated: PanelOptions = { ...current, buttonLabel: submit.fields.getTextInputValue("button_label"), buttonStyle: this.styleFromString(submit.fields.getTextInputValue("button_style")) };
		await message.edit({ components: [this.buildLivePanel(ctx.guild.name, updated)], flags: TICKET_V2_FLAGS }).catch(() => {});
		await submit.update({ components: [this.infoPanel("Button Updated", "The ticket button has been updated.")], flags: TICKET_V2_FLAGS });
	}

	private async handleChangeCategories(ctx: Context, interaction: any, config: TicketConfig): Promise<any> {
		const select = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
			new ChannelSelectMenuBuilder().setCustomId("category_change_select").setPlaceholder("Select the ticket category").setChannelTypes([ChannelType.GuildCategory]).setMinValues(1).setMaxValues(1),
		);
		await interaction.update({ components: [this.infoPanel("Change Category", "Select the category where new ticket channels will be created."), select], flags: TICKET_V2_FLAGS });

		const selection = await interaction.message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.ChannelSelect, time: 60_000 }).catch(() => null);
		if (!selection) return;
		await selection.deferUpdate();
		await TicketConfig.update(config.id, { categoryId: selection.values[0], openCategoryId: selection.values[0] });
		await selection.editReply({ components: [this.infoPanel("Category Updated", `New tickets will be created under <#${selection.values[0]}>.`)], flags: TICKET_V2_FLAGS });
	}

	// ─── edit / delete / info / list ────────────────────────────────────────

	private async handleEdit(ctx: Context): Promise<any> {
		const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
		if (!channel) {
			return ctx.editOrReply({ components: [this.infoPanel("Channel Not Found", "Please provide a valid text channel.")], flags: TICKET_V2_FLAGS });
		}

		const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);
		if (!ticketConfig) {
			return ctx.editOrReply({ components: [this.infoPanel("No Ticket System", "There is no ticket system in that channel.")], flags: TICKET_V2_FLAGS });
		}

		const panelChannel = ctx.guild.channels.cache.get(ticketConfig.channelId!) as TextChannel;
		const panelMessage = panelChannel ? await panelChannel.messages.fetch(ticketConfig.messageId!).catch(() => null) : null;

		const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId("edit_options")
				.setPlaceholder("Select what to edit")
				.addOptions(
					{ label: "Edit Panel Text", value: "edit_embed", description: "Edit the panel title and description" },
					{ label: "Edit Button", value: "edit_button", description: "Edit the ticket button" },
					{ label: "Add Support Roles", value: "add_role", description: "Set roles that can manage tickets" },
					{ label: "Add Logger Channel", value: "add_logger", description: "Set the ticket log channel" },
					{ label: "Set Open Limit", value: "add_open_limit", description: "Set maximum open tickets per user" },
					{ label: "Change Category", value: "change_categories", description: "Change the ticket category" },
				),
		);

		const message = await ctx.editOrReply({ components: [this.infoPanel("Edit Ticket System", "Choose what you want to edit."), select], flags: TICKET_V2_FLAGS });

		const selection = await message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.StringSelect, time: 60_000 }).catch(() => null);
		if (!selection) return;

		switch (selection.values[0]) {
			case "edit_embed":
				if (!panelMessage) return selection.reply({ content: "The ticket panel message could not be found.", flags: MessageFlags.Ephemeral });
				return this.handleEditPanelText(ctx, selection, panelMessage);
			case "edit_button":
				if (!panelMessage) return selection.reply({ content: "The ticket panel message could not be found.", flags: MessageFlags.Ephemeral });
				return this.handleEditButton(ctx, selection, panelMessage);
			case "add_role":
				return this.handleAddRole(ctx, selection, ticketConfig);
			case "add_logger":
				return this.handleAddLogger(ctx, selection, ticketConfig);
			case "add_open_limit":
				return this.handleOpenLimit(ctx, selection, ticketConfig);
			case "change_categories":
				return this.handleChangeCategories(ctx, selection, ticketConfig);
		}
	}

	private async handleDelete(ctx: Context): Promise<any> {
		const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
		if (!channel) {
			return ctx.editOrReply({ components: [this.infoPanel("Channel Not Found", "Please provide a valid text channel.")], flags: TICKET_V2_FLAGS });
		}

		const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);
		if (!ticketConfig) {
			return ctx.editOrReply({ components: [this.infoPanel("No Ticket System", "There is no ticket system in that channel.")], flags: TICKET_V2_FLAGS });
		}

		const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_delete").setLabel("Delete System").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("cancel_delete").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		const message = await ctx.editOrReply({
			components: [this.infoPanel("Delete Ticket System", `Are you sure you want to delete the ticket system in <#${channel.id}>? This cannot be undone.`), confirmRow],
			flags: TICKET_V2_FLAGS,
		});

		const selection = await message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.Button, time: 30_000 }).catch(() => null);
		if (!selection) {
			return message.edit({ components: [this.infoPanel("Action Cancelled", "The deletion timed out.")], flags: TICKET_V2_FLAGS }).catch(() => {});
		}

		if (selection.customId === "confirm_delete") {
			await selection.deferUpdate();
			try {
				const panelChannel = ctx.guild.channels.cache.get(ticketConfig.channelId!) as TextChannel;
				if (panelChannel && ticketConfig.messageId) {
					const panelMessage = await panelChannel.messages.fetch(ticketConfig.messageId).catch(() => null);
					await panelMessage?.delete().catch(() => null);
				}
			} catch {}
			await TicketConfig.delete(ticketConfig.id);
			return selection.editReply({ components: [this.infoPanel("Ticket System Deleted", `The ticket system in <#${channel.id}> has been deleted.`)], flags: TICKET_V2_FLAGS });
		}

		await selection.update({ components: [this.infoPanel("Action Cancelled", "The deletion has been cancelled.")], flags: TICKET_V2_FLAGS });
	}

	private async handleInfo(ctx: Context): Promise<any> {
		const channel = ctx.options.getChannel("channel", true, 1) as TextChannel;
		if (!channel) {
			return ctx.editOrReply({ components: [this.infoPanel("Channel Not Found", "Please provide a valid text channel.")], flags: TICKET_V2_FLAGS });
		}

		const ticketConfig = await TicketConfig.getByChannelId(ctx.guild.id, channel.id);
		if (!ticketConfig) {
			return ctx.editOrReply({ components: [this.infoPanel("No Ticket System", "There is no ticket system in that channel.")], flags: TICKET_V2_FLAGS });
		}

		const panel = this.infoPanel("Ticket System Info", `Configuration for <#${ticketConfig.channelId}>.`, [
			["Panel Channel", ticketConfig.channelId ? `<#${ticketConfig.channelId}>` : "None"],
			["Category", ticketConfig.categoryId ? `<#${ticketConfig.categoryId}>` : "None"],
			["Open Category", ticketConfig.openCategoryId ? `<#${ticketConfig.openCategoryId}>` : "None"],
			["Support Roles", ticketConfig.supportRoles.length ? ticketConfig.supportRoles.map((role) => `<@&${role}>`).join(", ") : "None"],
			["Open Limit", String(ticketConfig.openLimit)],
			["Logger Channel", ticketConfig.loggerChannelId ? `<#${ticketConfig.loggerChannelId}>` : "None"],
			["Message ID", `\`${ticketConfig.messageId ?? "None"}\``],
		]);

		const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("edit_this").setLabel("Edit This System").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("delete_this").setLabel("Delete This System").setStyle(ButtonStyle.Danger),
		);

		const message = await ctx.editOrReply({ components: [panel, actions], flags: TICKET_V2_FLAGS });

		const selection = await message.awaitMessageComponent({ filter: this.authorFilter(ctx), componentType: ComponentType.Button, time: 60_000 }).catch(() => null);
		if (!selection) return;

		await selection.deferUpdate();
		ctx.options = {
			...ctx.options,
			getSubCommand: () => (selection.customId === "edit_this" ? "edit" : "delete"),
			getChannel: () => channel,
		} as any;
		return this.run(ctx);
	}

	private async handleList(ctx: Context): Promise<any> {
		const ticketConfigs = await TicketConfig.getAllByGuildId(ctx.guild.id);
		if (!ticketConfigs || ticketConfigs.length === 0) {
			return ctx.editOrReply({ components: [this.infoPanel("No Ticket Systems", "There are no ticket systems in this server.")], flags: TICKET_V2_FLAGS });
		}

		const sections: Array<[string, string]> = ticketConfigs.map((config, index) => {
			const channelName = config.channelId ? ctx.guild.channels.cache.get(config.channelId)?.name ?? "unknown" : "unknown";
			return [
				`Ticket System #${index + 1}`,
				[
					`Channel: ${config.channelId ? `<#${config.channelId}>` : "None"}`,
					`Support Roles: ${config.supportRoles.length ? config.supportRoles.map((role) => `<@&${role}>`).join(", ") : "None"}`,
					`Open Limit: ${config.openLimit}`,
					`Details: \`/ticket info channel: #${channelName}\``,
				].join("\n"),
			];
		});

		const panel = this.infoPanel("Ticket Systems", `Found ${ticketConfigs.length} ticket system${ticketConfigs.length === 1 ? "" : "s"} in this server.`, sections);
		return ctx.editOrReply({ components: [panel], flags: TICKET_V2_FLAGS });
	}
}
