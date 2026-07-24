import { AutoMod } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ContainerBuilder,
	MessageFlags,
	ModalBuilder,
	RoleSelectMenuBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	UserSelectMenuBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ButtonInteraction,
} from "discord.js";

/** Build a Components V2 panel with title, divider, and body */
function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class AutoModCommand extends Command {
	constructor() {
		super({
			name: "automod",
			description: {
				content: "Configure automod settings for your server",
				examples: ["automod"],
				usage: "automod",
			},
			category: "automod",
			aliases: ["am"],
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

	public async run(ctx: Context): Promise<any> {
		let settings = await AutoMod.get(ctx.guild.id!);

		// Ensure default settings exist
		if (!settings.spam) {
			settings.spam = {
				enabled: false,
				action: "timeout",
				spamLimit: 5,
				maxEmojis: 10,
				ignoredChannels: [],
				ignoredRoles: [],
				ignoredUsers: [],
			};
		}

		if (!settings.link) {
			settings.link = {
				enabled: false,
				action: "delete",
				allowedDomains: [],
				ignoredChannels: [],
				ignoredRoles: [],
				ignoredUsers: [],
			};
		}

		const getContainer = (ctx: Context, settings: AutoMod) => {
			const on = ctx.client.config.emojis.on || "<:Tick:1375519268292264012>";
			const off = ctx.client.config.emojis.off || "<:Cross:1375519752746958858>";

			const body = [
				`**Global Status:** ${settings.enabled ? `${on} Enabled` : `${off} Disabled`}`,
				"",
				`🔄 **Spam Protection**`,
				`**Status:** ${settings.spam?.enabled ? `${on} Enabled` : `${off} Disabled`}`,
				`**Action:** ${settings.spam?.action || "None"}`,
				`**Message Limit:** ${settings.spam?.spamLimit || 0} messages`,
				`**Max Emojis:** ${settings.spam?.maxEmojis || 0} per message`,
				`**Ignored:** ${settings.spam?.ignoredChannels?.length || 0} channels, ${settings.spam?.ignoredRoles?.length || 0} roles, ${settings.spam?.ignoredUsers?.length || 0} users`,
				"",
				`🔗 **Link Protection**`,
				`**Status:** ${settings.link?.enabled ? `${on} Enabled` : `${off} Disabled`}`,
				`**Action:** ${settings.link?.action || "None"}`,
				`**Allowed Domains:** ${settings.link?.allowedDomains?.length || 0}`,
				`**Ignored:** ${settings.link?.ignoredChannels?.length || 0} channels, ${settings.link?.ignoredRoles?.length || 0} roles, ${settings.link?.ignoredUsers?.length || 0} users`,
				"",
				`-# Select an option below to configure AutoMod settings`,
			].join("\n");

			return buildPanel("🛡️ AutoMod Configuration", body);
		};

		// Main navigation buttons
		const getMainButtons = (settings: AutoMod) => {
			const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("automod_toggle")
					.setLabel(settings.enabled ? "Disable AutoMod" : "Enable AutoMod")
					.setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
					.setEmoji(settings.enabled ? "🔴" : "🟢"),
			);

			const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("automod_menu")
					.setPlaceholder("Select a feature to configure...")
					.addOptions([
						new StringSelectMenuOptionBuilder().setLabel("Spam Protection").setDescription("Configure spam message and emoji limits").setValue("spam").setEmoji("🔄"),
						new StringSelectMenuOptionBuilder().setLabel("Link Protection").setDescription("Configure link filtering and allowed domains").setValue("links").setEmoji("🔗"),
						new StringSelectMenuOptionBuilder().setLabel("Manage Exceptions").setDescription("Configure ignored channels, roles, and users").setValue("ignored").setEmoji("🛡️"),
					]),
			);

			return [row1, row2];
		};

		const homeButton = new ButtonBuilder().setCustomId("automod_home").setLabel("Back to Main Menu").setStyle(ButtonStyle.Secondary).setEmoji("🏠");

		const msg = await ctx.editOrReply({
			components: [getContainer(ctx, settings), ...getMainButtons(settings)],
			flags: MessageFlags.IsComponentsV2,
		});

		const filter = (i: any) => {
			if (i.user.id === ctx.author?.id) return true;
			i.reply({
				embeds: [
					{
						color: ctx.client.config.colors.red,
						description: "<:Cross:1375519752746958858> Only the command author can use these controls.",
					},
				],
				flags: MessageFlags.Ephemeral,
			});
			return false;
		};

		const collector = msg.createMessageComponentCollector({
			filter,
			time: 10 * 60 * 1000, // 10 minutes
		});

		collector.on("collect", async (i) => {
			// Main menu toggle button
			if (i.customId === "automod_toggle") {
				settings = await AutoMod.update(ctx.guild.id!, { enabled: !settings.enabled });
				await i.update({
					components: [getContainer(ctx, settings), ...getMainButtons(settings)],
				});
			}
			// Main menu select menu
			else if (i.customId === "automod_menu" && i.isStringSelectMenu()) {
				const selected = i.values[0];

				if (selected === "spam") {
					await handleSpamMenu(i);
				} else if (selected === "links") {
					await handleLinkMenu(i);
				} else if (selected === "ignored") {
					await handleIgnoredMenu(i);
				}
			}
			// Back to home button
			else if (i.customId === "automod_home") {
				await i.update({
					components: [getContainer(ctx, settings), ...getMainButtons(settings)],
				});
			}
			// Spam toggle button
			else if (i.customId === "spam_toggle") {
				settings.spam!.enabled = !settings.spam!.enabled;
				settings = await AutoMod.update(ctx.guild.id!, settings);
				await handleSpamMenu(i);
			}
			// Link toggle button
			else if (i.customId === "link_toggle") {
				settings.link!.enabled = !settings.link!.enabled;
				settings = await AutoMod.update(ctx.guild.id!, settings);
				await handleLinkMenu(i);
			}
			// Configure spam settings button
			else if (i.customId === "spam_settings") {
				await showSpamSettingsModal(i as ButtonInteraction);
			}
			// Configure link settings button
			else if (i.customId === "link_settings") {
				await showLinkSettingsModal(i as ButtonInteraction);
			}
			// Spam ignored menu
			else if (i.customId === "spam_ignored") {
				await handleSpamIgnoredMenu(i);
			}
			// Link ignored menu
			else if (i.customId === "link_ignored") {
				await handleLinkIgnoredMenu(i);
			}
			// Spam ignored user select menu
			else if (i.customId === "automod_spam_ignored_user" && i.isUserSelectMenu()) {
				const users = i.values ?? [];
				settings.spam = {
					...settings.spam!,
					ignoredUsers: users.map((u) => ({ id: u })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated spam protection ignored users")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleSpamIgnoredMenu(i);
			}
			// Spam ignored role select menu
			else if (i.customId === "automod_spam_ignored_role" && i.isRoleSelectMenu()) {
				const roles = i.values ?? [];
				settings.spam = {
					...settings.spam!,
					ignoredRoles: roles.map((r) => ({ id: r })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated spam protection ignored roles")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleSpamIgnoredMenu(i);
			}
			// Spam ignored channel select menu
			else if (i.customId === "automod_spam_ignored_channel" && i.isChannelSelectMenu()) {
				const channels = i.values ?? [];
				settings.spam = {
					...settings.spam!,
					ignoredChannels: channels.map((c) => ({ id: c })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated spam protection ignored channels")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleSpamIgnoredMenu(i);
			}
			// Link ignored user select menu
			else if (i.customId === "automod_links_ignored_user" && i.isUserSelectMenu()) {
				const users = i.values ?? [];
				settings.link = {
					...settings.link!,
					ignoredUsers: users.map((u) => ({ id: u })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated link protection ignored users")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleLinkIgnoredMenu(i);
			}
			// Link ignored role select menu
			else if (i.customId === "automod_links_ignored_role" && i.isRoleSelectMenu()) {
				const roles = i.values ?? [];
				settings.link = {
					...settings.link!,
					ignoredRoles: roles.map((r) => ({ id: r })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated link protection ignored roles")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleLinkIgnoredMenu(i);
			}
			// Link ignored channel select menu
			else if (i.customId === "automod_links_ignored_channel" && i.isChannelSelectMenu()) {
				const channels = i.values ?? [];
				settings.link = {
					...settings.link!,
					ignoredChannels: channels.map((c) => ({ id: c })),
				};
				settings = await AutoMod.update(ctx.guild.id!, settings);

				await i.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Success", "Updated link protection ignored channels")],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});
				await handleLinkIgnoredMenu(i);
			}
			// Return to spam menu from ignored menu
			else if (i.customId === "back_to_spam") {
				await handleSpamMenu(i);
			}
			// Return to link menu from ignored menu
			else if (i.customId === "back_to_link") {
				await handleLinkMenu(i);
			}
		});

		collector.on("end", async () => {
			await msg
				.edit({
					components: [buildPanel("AutoMod Configuration", "This configuration session has expired. Use `/automod` to start a new session.")],
					embeds: [],
				})
				.catch(() => { });
		});

		// Handle spam menu
		async function handleSpamMenu(i: any) {
			const body = [
				`**Status:** ${settings.spam?.enabled ? "<:Tick:1375519268292264012> Enabled" : "<:Cross:1375519752746958858> Disabled"}`,
				`**Action:** ${settings.spam?.action || "None"}`,
				`**Message Limit:** ${settings.spam?.spamLimit || 0} messages`,
				`**Max Emojis:** ${settings.spam?.maxEmojis || 0} per message`,
				"",
				"-# Use the buttons below to configure spam protection",
			].join("\n");

			const container = buildPanel("🔄 Spam Protection", body);

			const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("spam_toggle")
					.setLabel(settings.spam?.enabled ? "Disable Spam Protection" : "Enable Spam Protection")
					.setStyle(settings.spam?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
					.setEmoji(settings.spam?.enabled ? "🔴" : "🟢"),
				new ButtonBuilder().setCustomId("spam_settings").setLabel("Configure Settings").setStyle(ButtonStyle.Primary).setEmoji("⚙️"),
			);

			const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("spam_ignored").setLabel("Manage Exceptions").setStyle(ButtonStyle.Secondary).setEmoji("🛡️"),
				homeButton,
			);

			await i.update({
				components: [container, row1, row2],
			});
		}

		// Handle link menu
		async function handleLinkMenu(i: any) {
			const domainsText = settings.link?.allowedDomains && settings.link.allowedDomains.length > 0
				? settings.link.allowedDomains.join(", ")
				: "No domains added";

			const body = [
				`**Status:** ${settings.link?.enabled ? "<:Tick:1375519268292264012> Enabled" : "<:Cross:1375519752746958858> Disabled"}`,
				`**Action:** ${settings.link?.action || "None"}`,
				`**Allowed Domains:** ${settings.link?.allowedDomains?.length || 0}`,
				"",
				`**Allowed Domains List:** ${domainsText}`,
				"",
				"-# Use the buttons below to configure link protection",
			].join("\n");

			const container = buildPanel("🔗 Link Protection", body);

			const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("link_toggle")
					.setLabel(settings.link?.enabled ? "Disable Link Protection" : "Enable Link Protection")
					.setStyle(settings.link?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
					.setEmoji(settings.link?.enabled ? "🔴" : "🟢"),
				new ButtonBuilder().setCustomId("link_settings").setLabel("Configure Settings").setStyle(ButtonStyle.Primary).setEmoji("⚙️"),
			);

			const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("link_ignored").setLabel("Manage Exceptions").setStyle(ButtonStyle.Secondary).setEmoji("🛡️"),
				homeButton,
			);

			await i.update({
				components: [container, row1, row2],
			});
		}

		// Handle ignored menu
		async function handleIgnoredMenu(i: any) {
			const container = buildPanel("🛡️ Exception Management", "Select which protection feature you want to configure exceptions for.");

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("spam_ignored").setLabel("Spam Protection Exceptions").setStyle(ButtonStyle.Primary).setEmoji("🔄"),
				new ButtonBuilder().setCustomId("link_ignored").setLabel("Link Protection Exceptions").setStyle(ButtonStyle.Primary).setEmoji("🔗"),
				homeButton,
			);

			await i.update({
				components: [container, row],
			});
		}

		// Show spam settings modal
		async function showSpamSettingsModal(i: ButtonInteraction) {
			const modal = new ModalBuilder().setCustomId("automod_spam").setTitle("Spam Protection Settings");

			const actionOptions = ["ban", "timeout", "kick", "warn", "delete"];

			const action = new TextInputBuilder()
				.setCustomId("automod_spam_action")
				.setLabel(`Action (${actionOptions.join(", ")})`)
				.setPlaceholder("Choose an action from the list above")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(settings.spam?.action || "timeout");

			const spamLimit = new TextInputBuilder()
				.setCustomId("automod_spam_limit")
				.setLabel("Message Limit (0 to disable)")
				.setPlaceholder("Number of messages allowed in quick succession")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(String(settings.spam?.spamLimit || 5));

			const maxEmojis = new TextInputBuilder()
				.setCustomId("automod_spam_maxEmojis")
				.setLabel("Max Emojis (0 to disable)")
				.setPlaceholder("Maximum number of emojis allowed per message")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(String(settings.spam?.maxEmojis || 10));

			modal.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(action),
				new ActionRowBuilder<TextInputBuilder>().addComponents(spamLimit),
				new ActionRowBuilder<TextInputBuilder>().addComponents(maxEmojis),
			);

			await i.showModal(modal);

			try {
				const submission = await i.awaitModalSubmit({
					filter: (i) => i.user.id === ctx.author?.id,
					time: 60000,
				});

				const action = submission.fields.getTextInputValue("automod_spam_action").toLowerCase();
				const spamLimit = submission.fields.getTextInputValue("automod_spam_limit");
				const maxEmojis = submission.fields.getTextInputValue("automod_spam_maxEmojis");

				// Validate action
				if (!actionOptions.includes(action)) {
					return submission.reply({
						components: [buildPanel("<:Cross:1375519752746958858> Error", `Invalid action. Please use one of: ${actionOptions.join(", ")}`)],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					});
				}

				// Validate numbers
				if (Number.isNaN(Number(spamLimit)) || Number.isNaN(Number(maxEmojis))) {
					return submission.reply({
						components: [buildPanel("<:Cross:1375519752746958858> Error", "Message limit and max emojis must be numbers.")],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					});
				}

				// Update settings
				settings.spam = {
					enabled: true, // Enable spam protection when settings are updated
					action: action as any,
					spamLimit: Number(spamLimit),
					maxEmojis: Number(maxEmojis),
					ignoredChannels: settings.spam?.ignoredChannels ?? [],
					ignoredRoles: settings.spam?.ignoredRoles ?? [],
					ignoredUsers: settings.spam?.ignoredUsers ?? [],
				};

				settings = await AutoMod.update(ctx.guild.id!, settings);

				const spamUpdatedBody = [
					`**Action:** ${action}`,
					`**Message Limit:** ${spamLimit} messages`,
					`**Max Emojis:** ${maxEmojis} per message`,
				].join("\n");

				await submission.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Spam Protection Updated", spamUpdatedBody)],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});

				// Update the main message
				const message = await submission.message?.fetch();
				if (message) {
					await handleSpamMenu({ update: message.edit.bind(message) });
				}
			} catch (error) {
				console.error("Modal submission error:", error);
			}
		}

		// Show link settings modal
		async function showLinkSettingsModal(i: ButtonInteraction) {
			const modal = new ModalBuilder().setCustomId("automod_links").setTitle("Link Protection Settings");

			const actionOptions = ["delete", "ban", "timeout", "kick", "warn"];

			const action = new TextInputBuilder()
				.setCustomId("automod_links_action")
				.setLabel(`Action (${actionOptions.join(", ")})`)
				.setPlaceholder("Choose an action from the list above")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(settings.link?.action || "delete");

			const allowed = new TextInputBuilder()
				.setCustomId("automod_links_allowed")
				.setLabel("Allowed Domains (comma separated)")
				.setPlaceholder("example.com, discord.com, github.com")
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(false)
				.setValue(settings.link?.allowedDomains?.join(", ") || "");

			modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(action), new ActionRowBuilder<TextInputBuilder>().addComponents(allowed));

			await i.showModal(modal);

			try {
				const submission = await i.awaitModalSubmit({
					filter: (i) => i.user.id === ctx.author?.id,
					time: 60000,
				});

				const action = submission.fields.getTextInputValue("automod_links_action").toLowerCase();
				const allowedText = submission.fields.getTextInputValue("automod_links_allowed");

				// Validate action
				if (!actionOptions.includes(action)) {
					return submission.reply({
						components: [buildPanel("<:Cross:1375519752746958858> Error", `Invalid action. Please use one of: ${actionOptions.join(", ")}`)],
						flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
					});
				}

				// Process domains
				const allowedDomains = allowedText ? allowedText
					.split(",")
					.map((domain) => domain.trim())
					.filter((domain) => domain.length > 0) : [];

				// Update settings
				settings.link = {
					enabled: true, // Enable link protection when settings are updated
					action: action as any,
					allowedDomains: allowedDomains,
					ignoredChannels: settings.link?.ignoredChannels ?? [],
					ignoredRoles: settings.link?.ignoredRoles ?? [],
					ignoredUsers: settings.link?.ignoredUsers ?? [],
				};

				settings = await AutoMod.update(ctx.guild.id!, settings);

				const linkUpdatedBody = [
					`**Action:** ${action}`,
					`**Allowed Domains:** ${allowedDomains.length > 0 ? allowedDomains.join(", ") : "None"}`,
				].join("\n");

				await submission.reply({
					components: [buildPanel("<:Tick:1375519268292264012> Link Protection Updated", linkUpdatedBody)],
					flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				});

				// Update the main message
				const message = await submission.message?.fetch();
				if (message) {
					await handleLinkMenu({ update: message.edit.bind(message) });
				}
			} catch (error) {
				console.error("Modal submission error:", error);
			}
		}

		// Handle spam ignored menu
		async function handleSpamIgnoredMenu(i: any) {
			const users = settings.spam?.ignoredUsers ?? [];
			const roles = settings.spam?.ignoredRoles ?? [];
			const channels = settings.spam?.ignoredChannels ?? [];

			const body = [
				"Configure which users, roles, and channels should be exempt from spam protection.",
				"",
				"**Current Exceptions:**",
				`• ${users.length} Users`,
				`• ${roles.length} Roles`,
				`• ${channels.length} Channels`,
				"",
				"-# Use the select menus below to update exceptions",
			].join("\n");

			const container = buildPanel("🔄 Spam Protection Exceptions", body);

			const usermenu = new UserSelectMenuBuilder().setCustomId("automod_spam_ignored_user").setPlaceholder("Select users to exempt from spam protection").setMinValues(0).setMaxValues(25);

			const rolemenu = new RoleSelectMenuBuilder().setCustomId("automod_spam_ignored_role").setPlaceholder("Select roles to exempt from spam protection").setMinValues(0).setMaxValues(25);

			const channelmenu = new ChannelSelectMenuBuilder().setCustomId("automod_spam_ignored_channel").setPlaceholder("Select channels to exempt from spam protection").setMinValues(0).setMaxValues(25);

			// Set default values if they exist
			if (users.length > 0) {
				usermenu.setDefaultUsers(...users.map((u) => u.id));
			}

			if (roles.length > 0) {
				rolemenu.setDefaultRoles(...roles.map((r) => r.id));
			}

			if (channels.length > 0) {
				channelmenu.setDefaultChannels(...channels.map((c) => c.id));
			}

			const row1 = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(usermenu);
			const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(rolemenu);
			const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelmenu);

			const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("back_to_spam").setLabel("Back to Spam Settings").setStyle(ButtonStyle.Secondary).setEmoji("↩️"),
				homeButton,
			);

			await i.update({
				components: [container, row1, row2, row3, row4],
			});
		}

		async function handleLinkIgnoredMenu(i: any) {
			const users = settings.link?.ignoredUsers ?? [];
			const roles = settings.link?.ignoredRoles ?? [];
			const channels = settings.link?.ignoredChannels ?? [];

			const body = [
				"Configure which users, roles, and channels should be exempt from link protection.",
				"",
				"**Current Exceptions:**",
				`• ${users.length} Users`,
				`• ${roles.length} Roles`,
				`• ${channels.length} Channels`,
				"",
				"-# Use the select menus below to update exceptions",
			].join("\n");

			const container = buildPanel("🔗 Link Protection Exceptions", body);

			const usermenu = new UserSelectMenuBuilder()
				.setCustomId("automod_links_ignored_user")
				.setPlaceholder("Select users to exempt from link protection")
				.setMinValues(0)
				.setMaxValues(25);

			const rolemenu = new RoleSelectMenuBuilder()
				.setCustomId("automod_links_ignored_role")
				.setPlaceholder("Select roles to exempt from link protection")
				.setMinValues(0)
				.setMaxValues(25);

			const channelmenu = new ChannelSelectMenuBuilder()
				.setCustomId("automod_links_ignored_channel")
				.setPlaceholder("Select channels to exempt from link protection")
				.setMinValues(0)
				.setMaxValues(25);

			// Set default values if they exist
			if (users.length > 0) {
				usermenu.setDefaultUsers(...users.map((u) => u.id));
			}

			if (roles.length > 0) {
				rolemenu.setDefaultRoles(...roles.map((r) => r.id));
			}

			if (channels.length > 0) {
				channelmenu.setDefaultChannels(...channels.map((c) => c.id));
			}

			const row1 = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(usermenu);
			const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(rolemenu);
			const row3 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelmenu);

			const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("back_to_link").setLabel("Back to Link Settings").setStyle(ButtonStyle.Secondary).setEmoji("↩️"),
				homeButton,
			);

			await i.update({
				components: [container, row1, row2, row3, row4],
			});
		}
	}
}
