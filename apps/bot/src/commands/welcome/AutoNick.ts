import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AutoNick } from "@repo/db";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class AutoNickCommand extends Command {
	constructor() {
		super({
			name: "autonick",
			description: {
				content: "Configure automatic nicknames for new members",
				usage: "autonick",
				examples: ["autonick"],
			},
			category: "welcome",
			aliases: ["anick", "auto-nick"],
			permissions: {
				client: ["ManageNicknames"],
				user: ["Administrator"],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!ctx.guild || !ctx.author) return;

		// Get current configuration
		const config = await AutoNick.get(ctx.guild.id);

		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("autonick_set")
				.setLabel(config?.nickname ? "Update Format" : "Set Format")
				.setStyle(ButtonStyle.Primary)
				.setEmoji("✏️"),
			new ButtonBuilder()
				.setCustomId("autonick_clear")
				.setLabel("Clear")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("🗑️")
				.setDisabled(!config?.nickname),
			new ButtonBuilder()
				.setCustomId("autonick_toggle")
				.setLabel(config?.enabled ? "Disable" : "Enable")
				.setStyle(config?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
				.setEmoji(config?.enabled ? "❌" : "✅")
				.setDisabled(!config?.nickname),
			new ButtonBuilder()
				.setCustomId("autonick_preview")
				.setLabel("Preview")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("👁️")
				.setDisabled(!config?.nickname),
		);

		const container = await this.createMainPanel(ctx, config);

		const message = await ctx.editOrReply({
			components: [container, buttons],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 120_000, // Extended to 2 minutes
			filter: (i) => i.user.id === ctx.author?.id,
		});

		collector.on("collect", async (interaction) => {
			switch (interaction.customId) {
				case "autonick_set":
					return this.handleSet(ctx, interaction);
				case "autonick_clear":
					return this.handleClear(ctx, interaction);
				case "autonick_toggle":
					return this.handleToggle(ctx, interaction);
				case "autonick_preview":
					return this.handlePreview(ctx, interaction);
			}
		});

		collector.on("end", async () => {
			if (message) {
				const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId("autonick_set")
						.setLabel("Set Format")
						.setStyle(ButtonStyle.Primary)
						.setEmoji("✏️")
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId("autonick_clear")
						.setLabel("Clear")
						.setStyle(ButtonStyle.Secondary)
						.setEmoji("🗑️")
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId("autonick_toggle")
						.setLabel("Toggle")
						.setStyle(ButtonStyle.Success)
						.setEmoji("🔄")
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId("autonick_preview")
						.setLabel("Preview")
						.setStyle(ButtonStyle.Secondary)
						.setEmoji("👁️")
						.setDisabled(true),
				);

				await message.edit({
					components: [disabledButtons],
				}).catch(() => { });
			}
		});
	}

	private async createMainPanel(ctx: Context, config: any): Promise<ContainerBuilder> {
		const statusEmoji = config?.enabled ? "🟢" : config?.nickname ? "🟡" : "🔴";
		const statusText = config?.enabled ? "Active" : config?.nickname ? "Configured but Disabled" : "Not Configured";

		const lines = [
			`**📊 Status:** ${statusEmoji} **${statusText}**`,
		];

		if (config?.nickname) {
			lines.push(`**🎯 Current Format:** \`${config.nickname}\``);
		}

		lines.push(
			"",
			"**📝 How to Use:**",
			"• Click **Set Format** to create or update your nickname template",
			"• Use **Preview** to see how nicknames will look",
			"• **Enable/Disable** to control the system",
			"• **Clear** to remove all configuration",
			"",
			"**🔧 Available Variables:**",
			"`{user}` - User's display name (e.g., John)",
			"`{tag}` - User's full tag (e.g., John#1234)",
			"`{username}` - User's username only (e.g., john123)",
			"`{displayname}` - User's full display name (e.g., John Smith)",
			"`{server}` - Server name",
			"`{membercount}` - Current member count",
			"`{date}` - Current date (MM/DD/YYYY)",
			"",
			"**💡 Example Formats:**",
			"`Welcome {user}!` → Welcome John!",
			"`{user} | Member #{membercount}` → John | Member #152",
			"`[{date}] {user}` → [12/25/2024] John",
		);

		if (config?.nickname) {
			const preview = this.generatePreview(config.nickname, ctx);
			lines.push("", `**👀 Live Preview:** \`${preview}\``);
		}

		lines.push("", "-# 💡 Tip: New members will automatically get nicknames when they join!");

		return buildPanel("🏷️ AutoNick Configuration", lines.join("\n"));
	}

	private generatePreview(format: string, ctx: Context): string {
		const now = new Date();
		const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`;

		return format
			.replace(/\{user\}/g, ctx.author?.displayName || "ExampleUser")
			.replace(/\{tag\}/g, ctx.author?.tag || "ExampleUser#1234")
			.replace(/\{username\}/g, ctx.author?.username || "exampleuser")
			.replace(/\{server\}/g, ctx.guild?.name || "Example Server")
			.replace(/\{membercount\}/g, ctx.guild?.memberCount?.toString() || "100")
			.replace(/\{date\}/g, dateStr);
	}

	private async handleSet(ctx: Context, interaction: ButtonInteraction) {
		const currentConfig = await AutoNick.get(ctx.guild.id);

		const modal = new ModalBuilder()
			.setCustomId("autonick_modal")
			.setTitle("🏷️ Set Auto Nickname Format")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("nickname")
						.setLabel("Nickname Format")
						.setStyle(TextInputStyle.Short)
						.setPlaceholder("e.g., Welcome {user}! or {user} | Member #{membercount}")
						.setRequired(true)
						.setMaxLength(32) // Discord nickname limit
						.setValue(currentConfig?.nickname || "")
				),
			);

		await interaction.showModal(modal);

		const submission = await interaction.awaitModalSubmit({
			time: 60_000,
		}).catch(() => null);

		if (!submission) return;

		const nickname = submission.fields.getTextInputValue("nickname").trim();

		if (!nickname) {
			return submission.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("❌ Please provide a valid nickname format."))],
			});
		}

		// Validate nickname length with variables expanded
		const preview = this.generatePreview(nickname, ctx);
		if (preview.length > 32) {
			return submission.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [buildPanel("❌ Format Too Long", `The generated nickname would be too long (${preview.length}/32 characters).\n\n**Preview:** \`${preview}\`\n\n**Tip:** Try using shorter variables or text.`)],
			});
		}

		await AutoNick.update(ctx.guild.id, {
			nickname,
			enabled: true // Auto-enable when setting
		});

		await submission.reply({
			components: [buildPanel("✅ Auto Nickname Updated!", `**📝 New Format:** \`${nickname}\`\n**👀 Preview:** \`${preview}\`\n\n-# The system has been automatically enabled!`)],
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		});

		// Update the main message
		setTimeout(async () => {
			const newConfig = await AutoNick.get(ctx.guild.id);
			const newPanel = await this.createMainPanel(ctx, newConfig);
			const newButtons = this.createButtons(newConfig);

			await interaction.message?.edit({
				components: [newPanel, newButtons],
			}).catch(() => { });
		}, 2000);
	}

	private async handleClear(ctx: Context, interaction: ButtonInteraction) {
		const existing = await AutoNick.get(ctx.guild.id);
		if (!existing?.nickname) {
			return interaction.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("❌ No auto nickname configuration found."))],
			});
		}

		await AutoNick.delete(ctx.guild.id);

		await interaction.reply({
			components: [buildPanel("🗑️ Configuration Cleared", "Auto nickname system has been completely removed.\n\n-# You can set up a new configuration anytime!")],
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		});

		// Update the main message
		setTimeout(async () => {
			const newPanel = await this.createMainPanel(ctx, null);
			const newButtons = this.createButtons(null);

			await interaction.message?.edit({
				components: [newPanel, newButtons],
			}).catch(() => { });
		}, 2000);
	}

	private async handleToggle(ctx: Context, interaction: ButtonInteraction) {
		const config = await AutoNick.get(ctx.guild.id);
		if (!config?.nickname) {
			return interaction.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("❌ No auto nickname format is configured. Please set one first!"))],
			});
		}

		const newState = !config.enabled;
		await AutoNick.update(ctx.guild.id, { enabled: newState });

		const toggleBody = [
			`Auto nickname system is now **${newState ? "active" : "inactive"}**.`,
			`**📝 Current Format:** \`${config.nickname}\``,
			newState ? "\n-# New members will now automatically receive nicknames!" : "",
		].join("\n");

		await interaction.reply({
			components: [buildPanel(`${newState ? "✅ System Enabled" : "❌ System Disabled"}`, toggleBody)],
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		});

		// Update the main message
		setTimeout(async () => {
			const newConfig = await AutoNick.get(ctx.guild.id);
			const newPanel = await this.createMainPanel(ctx, newConfig);
			const newButtons = this.createButtons(newConfig);

			await interaction.message?.edit({
				components: [newPanel, newButtons],
			}).catch(() => { });
		}, 2000);
	}

	private async handlePreview(ctx: Context, interaction: ButtonInteraction) {
		const config = await AutoNick.get(ctx.guild.id);
		if (!config?.nickname) {
			return interaction.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("❌ No nickname format configured."))],
			});
		}

		const preview = this.generatePreview(config.nickname, ctx);
		const examples = [
			{ user: "Alice", tag: "Alice#1234", username: "alice_gaming" },
			{ user: "Bob Smith", tag: "BobSmith#5678", username: "bobsmith" },
			{ user: "Charlie", tag: "Charlie#9999", username: "charlie123" },
		];

		const exampleLines = examples.map(ex => {
			const result = config.nickname
				.replace(/\{user\}/g, ex.user)
				.replace(/\{tag\}/g, ex.tag)
				.replace(/\{username\}/g, ex.username)
				.replace(/\{server\}/g, ctx.guild?.name || "Server")
				.replace(/\{membercount\}/g, ctx.guild?.memberCount?.toString() || "100")
				.replace(/\{date\}/g, new Date().toLocaleDateString());
			return `• \`${result}\``;
		}).join("\n");

		const previewBody = [
			`**Current Format:** \`${config.nickname}\``,
			"",
			`**🎯 Your Preview:** \`${preview}\``,
			"",
			`**📋 Example Outputs:**`,
			exampleLines,
			"",
			`-# Status: ${config.enabled ? "Active" : "Disabled"} | Length: ${preview.length}/32 characters`,
		].join("\n");

		return interaction.reply({
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			components: [buildPanel("👁️ Nickname Preview", previewBody)],
		});
	}

	private createButtons(config: any): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId("autonick_set")
				.setLabel(config?.nickname ? "Update Format" : "Set Format")
				.setStyle(ButtonStyle.Primary)
				.setEmoji("✏️"),
			new ButtonBuilder()
				.setCustomId("autonick_clear")
				.setLabel("Clear")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("🗑️")
				.setDisabled(!config?.nickname),
			new ButtonBuilder()
				.setCustomId("autonick_toggle")
				.setLabel(config?.enabled ? "Disable" : "Enable")
				.setStyle(config?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
				.setEmoji(config?.enabled ? "❌" : "✅")
				.setDisabled(!config?.nickname),
			new ButtonBuilder()
				.setCustomId("autonick_preview")
				.setLabel("Preview")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("👁️")
				.setDisabled(!config?.nickname),
		);
	}
}