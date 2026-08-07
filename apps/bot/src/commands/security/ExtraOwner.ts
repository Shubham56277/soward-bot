import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	MessageFlags,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { buildAntiNukePanel } from "../../modules/antiNukeUi";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ExtraOwnerLimits {
	memberBan: number;
	memberKick: number;
	roleAction: number;
	channelAction: number;
	webhookAction: number;
	emojiAction: number;
	mentionLimit: number;
	timeWindow: number;
}

interface ExtraOwnerConfig {
	userId: string;
	addedAt: number;
	limits: ExtraOwnerLimits;
	enforcement: "warn" | "rolestrip" | "kick" | "ban";
}

// ─── Constants ─────────────────────────────────────────────────────────────

const REDIS_KEY = (guildId: string) => `extraowners:${guildId}`;
const MAX_EXTRA_OWNERS = 20;
const COLLECTOR_TIMEOUT = 120_000;

const DEFAULT_LIMITS: ExtraOwnerLimits = {
	memberBan: 20,
	memberKick: 20,
	roleAction: 20,
	channelAction: 20,
	webhookAction: 20,
	emojiAction: 20,
	mentionLimit: 20,
	timeWindow: 600,
};

const DEFAULT_ENFORCEMENT: ExtraOwnerConfig["enforcement"] = "rolestrip";

// ─── Helpers ───────────────────────────────────────────────────────────────

function panel(title: string, body: string): ContainerBuilder {
	return buildAntiNukePanel(title, [body]);
}

function reply(ctx: Context, title: string, body: string): Promise<any> {
	return ctx.sendMessage({
		components: [panel(title, body)],
		flags: MessageFlags.IsComponentsV2,
		allowedMentions: { parse: [] },
	});
}

async function getExtraOwners(ctx: Context): Promise<ExtraOwnerConfig[]> {
	const raw = await ctx.client.redis.get(REDIS_KEY(ctx.guild.id));
	if (!raw) return [];
	try {
		return JSON.parse(raw) as ExtraOwnerConfig[];
	} catch {
		return [];
	}
}

async function setExtraOwners(ctx: Context, owners: ExtraOwnerConfig[]): Promise<void> {
	await ctx.client.redis.set(REDIS_KEY(ctx.guild.id), JSON.stringify(owners));
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
	if (!value || value.trim() === "") return fallback;
	const parsed = parseInt(value, 10);
	if (isNaN(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

// ─── Dashboard Builder ─────────────────────────────────────────────────────

async function buildDashboard(ctx: Context, owners: ExtraOwnerConfig[]): Promise<{ container: ContainerBuilder; row: ActionRowBuilder<ButtonBuilder> }> {
	const lines: string[] = [];
	for (let i = 0; i < owners.length; i++) {
		const entry = owners[i]!;
		const user = await ctx.client.users.fetch(entry.userId).catch(() => null);
		const name = user?.username ?? "Unknown";
		lines.push(`\`${i + 1}.\` **${name}** (\`${entry.userId}\`)`);
	}

	const container = buildAntiNukePanel("Extra Owners", [
		"Extra owners receive protected administrative access with configurable security limits.",
		[
			"**Configured Owners**",
			...(lines.length ? lines : ["No extra owners configured."]),
		].join("\n"),
		[`**Total:** ${owners.length} / ${MAX_EXTRA_OWNERS}`, "Only the Discord server owner can manage extra owners."].join("\n"),
	]);
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("eo_add").setLabel("Add Extra Owner").setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId("eo_configure").setLabel("Configure").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId("eo_remove").setLabel("Remove").setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId("eo_reset").setLabel("Reset").setStyle(ButtonStyle.Secondary),
	);

	return { container, row };
}

// ─── Config View Builder ───────────────────────────────────────────────────

async function buildConfigView(ctx: Context, config: ExtraOwnerConfig): Promise<{ container: ContainerBuilder; row: ActionRowBuilder<ButtonBuilder> }> {
	const user = await ctx.client.users.fetch(config.userId).catch(() => null);
	const name = user?.username ?? "Unknown";
	const container = buildAntiNukePanel("Extra Owner Configuration", [
		[`**User:** ${name}`, `**User ID:** \`${config.userId}\``].join("\n"),
		[
			"**Action Limits**",
			`Member Bans: **${config.limits.memberBan}** / ${config.limits.timeWindow} seconds`,
			`Member Kicks: **${config.limits.memberKick}** / ${config.limits.timeWindow} seconds`,
			`Channel Actions: **${config.limits.channelAction}** / ${config.limits.timeWindow} seconds`,
			`Role Actions: **${config.limits.roleAction}** / ${config.limits.timeWindow} seconds`,
			`Webhook Actions: **${config.limits.webhookAction}** / ${config.limits.timeWindow} seconds`,
			`Emoji Actions: **${config.limits.emojiAction}** / ${config.limits.timeWindow} seconds`,
			`Mention Limit: **${config.limits.mentionLimit}** / ${config.limits.timeWindow} seconds`,
		].join("\n"),
		[`**Enforcement:** ${capitalize(config.enforcement)}`, "**Protection:** Enabled"].join("\n"),
	]);
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`eoc_member_${config.userId}`).setLabel("Member").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`eoc_channel_${config.userId}`).setLabel("Channel").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`eoc_role_${config.userId}`).setLabel("Role").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`eoc_webhook_${config.userId}`).setLabel("Webhook").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(`eoc_other_${config.userId}`).setLabel("Other").setStyle(ButtonStyle.Primary),
	);

	return { container, row };
}

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Command ───────────────────────────────────────────────────────────────

export default class ExtraOwnerCommand extends Command {
	constructor() {
		super({
			name: "extraowner",
			description: {
				content: "Manage extra owners with configurable security limits",
				examples: ["extraowner", "extraowner add @user", "extraowner remove @user", "extraowner config @user", "extraowner list", "extraowner reset"],
				usage: "extraowner [add|remove|config|list|reset] [user]",
			},
			category: "security",
			cooldown: 3,
			args: false,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
			options: [
				{
					name: "add",
					description: "Add a user as extra owner",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to add", type: ApplicationCommandOptionType.User, required: true }],
				},
				{
					name: "remove",
					description: "Remove an extra owner",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to remove", type: ApplicationCommandOptionType.User, required: true }],
				},
				{
					name: "config",
					description: "Configure an extra owner's limits",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{ name: "user", description: "User to configure", type: ApplicationCommandOptionType.User, required: true }],
				},
				{ name: "list", description: "Show all extra owners", type: ApplicationCommandOptionType.Subcommand },
				{ name: "reset", description: "Clear all extra owners", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// Only the actual server owner can use this command
		if (ctx.author!.id !== ctx.guild.ownerId) {
			return reply(ctx, "Access Denied", "Only the Discord server owner can manage extra owners.");
		}

		const action = (ctx.options.getSubCommand(false, 0) ?? "list").toLowerCase();

		switch (action) {
			case "add":
				return this.handleAdd(ctx);
			case "remove":
				return this.handleRemove(ctx);
			case "config":
				return this.handleConfig(ctx);
			case "reset":
				return this.handleReset(ctx);
			case "list":
			default:
				return this.handleDashboard(ctx);
		}
	}

	// ─── Dashboard ────────────────────────────────────────────────────────────

	private async handleDashboard(ctx: Context): Promise<any> {
		const owners = await getExtraOwners(ctx);
		const { container, row } = await buildDashboard(ctx, owners);

		const msg = await ctx.sendMessage({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		});

		collector.on("collect", async (interaction) => {
			const currentOwners = await getExtraOwners(ctx);

			if (interaction.customId === "eo_add") {
				if (currentOwners.length >= MAX_EXTRA_OWNERS) {
					await interaction.reply({ components: [panel("Limit Reached", `You cannot add more than ${MAX_EXTRA_OWNERS} extra owners.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
					return;
				}
				await this.showAddPrompt(ctx, interaction, msg, collector);
			} else if (interaction.customId === "eo_configure") {
				if (currentOwners.length === 0) {
					await interaction.reply({ components: [panel("No Extra Owners", "There are no extra owners to configure.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
					return;
				}
				await this.showConfigSelect(ctx, interaction, currentOwners, msg, collector);
			} else if (interaction.customId === "eo_remove") {
				if (currentOwners.length === 0) {
					await interaction.reply({ components: [panel("No Extra Owners", "There are no extra owners to remove.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
					return;
				}
				await this.showRemoveSelect(ctx, interaction, currentOwners, msg, collector);
			} else if (interaction.customId === "eo_reset") {
				await this.showResetConfirm(ctx, interaction, currentOwners, msg, collector);
			}
		});

		collector.on("end", async () => {
			const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("eo_add").setLabel("Add Extra Owner").setStyle(ButtonStyle.Success).setDisabled(true),
				new ButtonBuilder().setCustomId("eo_configure").setLabel("Configure").setStyle(ButtonStyle.Primary).setDisabled(true),
				new ButtonBuilder().setCustomId("eo_remove").setLabel("Remove").setStyle(ButtonStyle.Danger).setDisabled(true),
				new ButtonBuilder().setCustomId("eo_reset").setLabel("Reset").setStyle(ButtonStyle.Secondary).setDisabled(true),
			);
			await msg.edit({ components: [container, disabledRow], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
		});
	}

	// ─── Add Flow (Command) ───────────────────────────────────────────────────

	private async handleAdd(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", true, 1);
		if (!user) return reply(ctx, "Missing User", "Specify a user: `extraowner add @user`");
		if (user.id === ctx.guild.ownerId) return reply(ctx, "Invalid User", "The server owner cannot be added as an extra owner.");

		const owners = await getExtraOwners(ctx);
		if (owners.some((o) => o.userId === user.id)) {
			return reply(ctx, "Already Added", `**${user.username}** is already an extra owner.`);
		}
		if (owners.length >= MAX_EXTRA_OWNERS) {
			return reply(ctx, "Limit Reached", `You cannot add more than ${MAX_EXTRA_OWNERS} extra owners.`);
		}

		// Show confirmation with buttons
		const body = [
			"This user will receive protected administrative access and may perform sensitive server actions within configured limits.",
			"Only add users you fully trust.",
		].join("\n");

		const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("eoa_configure").setLabel("Configure & Add").setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId("eoa_defaults").setLabel("Use Defaults").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("eoa_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		const msg = await ctx.sendMessage({ components: [panel("Add Extra Owner", body), confirmRow], flags: MessageFlags.IsComponentsV2 });
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		});

		collector.on("collect", async (interaction) => {
			if (interaction.customId === "eoa_cancel") {
				collector.stop();
				await msg.edit({ components: [panel("Cancelled", "Extra owner addition cancelled.")], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
				return;
			}

			if (interaction.customId === "eoa_defaults") {
				collector.stop();
				const currentOwners = await getExtraOwners(ctx);
				if (currentOwners.some((o) => o.userId === user.id)) {
					await msg.edit({ components: [panel("Already Added", `**${user.username}** is already an extra owner.`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
					return;
				}
				const newOwner: ExtraOwnerConfig = {
					userId: user.id,
					addedAt: Date.now(),
					limits: { ...DEFAULT_LIMITS },
					enforcement: DEFAULT_ENFORCEMENT,
				};
				currentOwners.push(newOwner);
				await setExtraOwners(ctx, currentOwners);
				await msg.edit({ components: [panel("Extra Owner Added", `**${user.username}** has been added as an extra owner with default limits.`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
				return;
			}

			if (interaction.customId === "eoa_configure") {
				const modal = new ModalBuilder()
					.setCustomId("eoa_modal")
					.setTitle("Configure Extra Owner")
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("eoa_userid").setLabel("User ID").setStyle(TextInputStyle.Short).setValue(user.id).setRequired(true),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("eoa_ban_limit").setLabel("Member Ban Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("eoa_kick_limit").setLabel("Member Kick Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("eoa_role_limit").setLabel("Role Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
						),
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder().setCustomId("eoa_channel_limit").setLabel("Channel Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
						),
					);

				await interaction.showModal(modal);

				const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i) => i.customId === "eoa_modal" && i.user.id === ctx.author!.id }).catch(() => null);
				if (!modalInteraction) {
					collector.stop();
					return;
				}

				const banLimit = clampInt(modalInteraction.fields.getTextInputValue("eoa_ban_limit"), 0, 100, 10);
				const kickLimit = clampInt(modalInteraction.fields.getTextInputValue("eoa_kick_limit"), 0, 100, 10);
				const roleLimit = clampInt(modalInteraction.fields.getTextInputValue("eoa_role_limit"), 0, 100, 10);
				const channelLimit = clampInt(modalInteraction.fields.getTextInputValue("eoa_channel_limit"), 0, 100, 10);

				collector.stop();
				const currentOwners = await getExtraOwners(ctx);
				if (currentOwners.some((o) => o.userId === user.id)) {
					await modalInteraction.reply({ components: [panel("Already Added", `**${user.username}** is already an extra owner.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
					return;
				}
				const newOwner: ExtraOwnerConfig = {
					userId: user.id,
					addedAt: Date.now(),
					limits: {
						memberBan: banLimit,
						memberKick: kickLimit,
						roleAction: roleLimit,
						channelAction: channelLimit,
						webhookAction: DEFAULT_LIMITS.webhookAction,
						emojiAction: DEFAULT_LIMITS.emojiAction,
						mentionLimit: DEFAULT_LIMITS.mentionLimit,
						timeWindow: DEFAULT_LIMITS.timeWindow,
					},
					enforcement: DEFAULT_ENFORCEMENT,
				};
				currentOwners.push(newOwner);
				await setExtraOwners(ctx, currentOwners);
				await modalInteraction.reply({ components: [panel("Extra Owner Added", `**${user.username}** has been added as an extra owner with custom limits.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
				await msg.edit({ components: [panel("Extra Owner Added", `**${user.username}** has been added as an extra owner.`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
				return;
			}
		});

		collector.on("end", async (_, reason) => {
			if (reason === "time") {
				await msg.edit({ components: [panel("Timed Out", "The interaction timed out.")], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
			}
		});
	}

	// ─── Add Prompt (from Dashboard button) ───────────────────────────────────

	private async showAddPrompt(ctx: Context, interaction: any, dashMsg: any, parentCollector: any): Promise<void> {
		const body = [
			"This user will receive protected administrative access and may perform sensitive server actions within configured limits.",
			"Only add users you fully trust.",
			"",
			"Please mention the user or provide their ID in the modal.",
		].join("\n");

		const modal = new ModalBuilder()
			.setCustomId("eoadd_modal")
			.setTitle("Add Extra Owner")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("eoadd_userid").setLabel("User ID").setStyle(TextInputStyle.Short).setPlaceholder("Enter user ID").setRequired(true),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("eoadd_ban_limit").setLabel("Member Ban Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("eoadd_kick_limit").setLabel("Member Kick Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("eoadd_role_limit").setLabel("Role Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("eoadd_channel_limit").setLabel("Channel Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue("10").setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === "eoadd_modal" && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const userId = modalInteraction.fields.getTextInputValue("eoadd_userid").trim();
		if (!/^\d{17,20}$/.test(userId)) {
			await modalInteraction.reply({ components: [panel("Invalid ID", "Please provide a valid user ID (17-20 digit number).")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const user = await ctx.client.users.fetch(userId).catch(() => null);
		if (!user) {
			await modalInteraction.reply({ components: [panel("User Not Found", "Could not find a user with that ID.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		if (user.bot) {
			await modalInteraction.reply({ components: [panel("Invalid User", "Bots cannot be added as extra owners.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		if (user.id === ctx.guild.ownerId) {
			await modalInteraction.reply({ components: [panel("Invalid User", "The server owner cannot be added as an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const currentOwners = await getExtraOwners(ctx);
		if (currentOwners.some((o) => o.userId === user.id)) {
			await modalInteraction.reply({ components: [panel("Already Added", `**${user.username}** is already an extra owner.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		if (currentOwners.length >= MAX_EXTRA_OWNERS) {
			await modalInteraction.reply({ components: [panel("Limit Reached", `You cannot add more than ${MAX_EXTRA_OWNERS} extra owners.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const banLimit = clampInt(modalInteraction.fields.getTextInputValue("eoadd_ban_limit"), 0, 100, 10);
		const kickLimit = clampInt(modalInteraction.fields.getTextInputValue("eoadd_kick_limit"), 0, 100, 10);
		const roleLimit = clampInt(modalInteraction.fields.getTextInputValue("eoadd_role_limit"), 0, 100, 10);
		const channelLimit = clampInt(modalInteraction.fields.getTextInputValue("eoadd_channel_limit"), 0, 100, 10);

		const newOwner: ExtraOwnerConfig = {
			userId: user.id,
			addedAt: Date.now(),
			limits: {
				memberBan: banLimit,
				memberKick: kickLimit,
				roleAction: roleLimit,
				channelAction: channelLimit,
				webhookAction: DEFAULT_LIMITS.webhookAction,
				emojiAction: DEFAULT_LIMITS.emojiAction,
				mentionLimit: DEFAULT_LIMITS.mentionLimit,
				timeWindow: DEFAULT_LIMITS.timeWindow,
			},
			enforcement: DEFAULT_ENFORCEMENT,
		};
		currentOwners.push(newOwner);
		await setExtraOwners(ctx, currentOwners);

		await modalInteraction.reply({ components: [panel("Extra Owner Added", `**${user.username}** has been added as an extra owner.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

		// Refresh the dashboard
		const refreshed = await getExtraOwners(ctx);
		const { container, row } = await buildDashboard(ctx, refreshed);
		await dashMsg.edit({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
	}

	// ─── Config Flow (Command) ────────────────────────────────────────────────

	private async handleConfig(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", true, 1);
		if (!user) return reply(ctx, "Missing User", "Specify a user: `extraowner config @user`");

		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === user.id);
		if (!config) {
			return reply(ctx, "Not Found", `**${user.username}** is not an extra owner.`);
		}

		await this.showConfigPanel(ctx, config);
	}

	// ─── Config Select (from Dashboard button) ────────────────────────────────

	private async showConfigSelect(ctx: Context, interaction: any, owners: ExtraOwnerConfig[], dashMsg: any, parentCollector: any): Promise<void> {
		const options = await Promise.all(
			owners.map(async (o) => {
				const user = await ctx.client.users.fetch(o.userId).catch(() => null);
				return { label: user?.username ?? "Unknown", description: `ID: ${o.userId}`, value: o.userId };
			}),
		);

		const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder().setCustomId("eoc_select").setPlaceholder("Select an extra owner to configure").addOptions(options),
		);

		await interaction.reply({ components: [panel("Select User", "Choose an extra owner to configure."), selectRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

		const selectInteraction = await interaction.channel?.awaitMessageComponent({
			componentType: ComponentType.StringSelect,
			filter: (i: any) => i.customId === "eoc_select" && i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		}).catch(() => null);

		if (!selectInteraction) return;

		const selectedUserId = selectInteraction.values[0];
		const currentOwners = await getExtraOwners(ctx);
		const config = currentOwners.find((o) => o.userId === selectedUserId);
		if (!config) {
			await selectInteraction.update({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 });
			return;
		}

		await this.showConfigPanelFromInteraction(ctx, config, selectInteraction);
	}

	// ─── Config Panel (from Command) ──────────────────────────────────────────

	private async showConfigPanel(ctx: Context, config: ExtraOwnerConfig): Promise<void> {
		const { container, row } = await buildConfigView(ctx, config);

		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${config.userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${config.userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);

		const msg = await ctx.sendMessage({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		});

		collector.on("collect", async (interaction) => {
			await this.handleConfigButton(ctx, interaction, config.userId, msg, collector);
		});

		collector.on("end", async () => {
			await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
		});
	}

	// ─── Config Panel (from Interaction) ──────────────────────────────────────

	private async showConfigPanelFromInteraction(ctx: Context, config: ExtraOwnerConfig, interaction: any): Promise<void> {
		const { container, row } = await buildConfigView(ctx, config);

		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${config.userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${config.userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);

		await interaction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });

		const msg = interaction.message;
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i: any) => i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		});

		collector.on("collect", async (btnInteraction: any) => {
			await this.handleConfigButton(ctx, btnInteraction, config.userId, msg, collector);
		});
	}

	// ─── Config Button Handler ─────────────────────────────────────────────────

	private async handleConfigButton(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const customId = interaction.customId as string;

		if (customId === `eoc_resetdef_${userId}`) {
			const owners = await getExtraOwners(ctx);
			const idx = owners.findIndex((o) => o.userId === userId);
			if (idx === -1) {
				await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
				return;
			}
			const owner = owners[idx]!;
			owner.limits = { ...DEFAULT_LIMITS };
			owner.enforcement = DEFAULT_ENFORCEMENT;
			await setExtraOwners(ctx, owners);
			const { container, row } = await buildConfigView(ctx, owner);
			const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
				new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
			);
			await interaction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
			return;
		}

		if (customId === `eoc_removeuser_${userId}`) {
			const owners = await getExtraOwners(ctx);
			const filtered = owners.filter((o) => o.userId !== userId);
			await setExtraOwners(ctx, filtered);
			collector.stop();
			const user = await ctx.client.users.fetch(userId).catch(() => null);
			await msg.edit({ components: [panel("Extra Owner Removed", `**${user?.username ?? userId}** has been removed from extra owners.`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
			return;
		}

		if (customId.startsWith("eoc_member_")) {
			await this.showMemberModal(ctx, interaction, userId, msg, collector);
		} else if (customId.startsWith("eoc_channel_")) {
			await this.showChannelModal(ctx, interaction, userId, msg, collector);
		} else if (customId.startsWith("eoc_role_")) {
			await this.showRoleModal(ctx, interaction, userId, msg, collector);
		} else if (customId.startsWith("eoc_webhook_")) {
			await this.showWebhookModal(ctx, interaction, userId, msg, collector);
		} else if (customId.startsWith("eoc_other_")) {
			await this.showOtherModal(ctx, interaction, userId, msg, collector);
		}
	}

	// ─── Member Modal ──────────────────────────────────────────────────────────

	private async showMemberModal(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === userId);
		if (!config) {
			await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId(`eocm_member_${userId}`)
			.setTitle("Member Limits")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("member_ban").setLabel("Member Ban Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.memberBan)).setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("member_kick").setLabel("Member Kick Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.memberKick)).setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === `eocm_member_${userId}` && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const banLimit = clampInt(modalInteraction.fields.getTextInputValue("member_ban"), 0, 100, config.limits.memberBan);
		const kickLimit = clampInt(modalInteraction.fields.getTextInputValue("member_kick"), 0, 100, config.limits.memberKick);

		const currentOwners = await getExtraOwners(ctx);
		const idx = currentOwners.findIndex((o) => o.userId === userId);
		if (idx === -1) {
			await modalInteraction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		const currentOwner = currentOwners[idx]!;
		currentOwner.limits.memberBan = banLimit;
		currentOwner.limits.memberKick = kickLimit;
		await setExtraOwners(ctx, currentOwners);

		const { container, row } = await buildConfigView(ctx, currentOwner);
		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);
		await modalInteraction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
	}

	// ─── Channel Modal ─────────────────────────────────────────────────────────

	private async showChannelModal(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === userId);
		if (!config) {
			await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId(`eocm_channel_${userId}`)
			.setTitle("Channel Limits")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("channel_action").setLabel("Channel Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.channelAction)).setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === `eocm_channel_${userId}` && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const channelLimit = clampInt(modalInteraction.fields.getTextInputValue("channel_action"), 0, 100, config.limits.channelAction);

		const currentOwners = await getExtraOwners(ctx);
		const idx = currentOwners.findIndex((o) => o.userId === userId);
		if (idx === -1) {
			await modalInteraction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		const currentOwner = currentOwners[idx]!;
		currentOwner.limits.channelAction = channelLimit;
		await setExtraOwners(ctx, currentOwners);

		const { container, row } = await buildConfigView(ctx, currentOwner);
		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);
		await modalInteraction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
	}

	// ─── Role Modal ────────────────────────────────────────────────────────────

	private async showRoleModal(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === userId);
		if (!config) {
			await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId(`eocm_role_${userId}`)
			.setTitle("Role Limits")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("role_action").setLabel("Role Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.roleAction)).setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === `eocm_role_${userId}` && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const roleLimit = clampInt(modalInteraction.fields.getTextInputValue("role_action"), 0, 100, config.limits.roleAction);

		const currentOwners = await getExtraOwners(ctx);
		const idx = currentOwners.findIndex((o) => o.userId === userId);
		if (idx === -1) {
			await modalInteraction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		const currentOwner = currentOwners[idx]!;
		currentOwner.limits.roleAction = roleLimit;
		await setExtraOwners(ctx, currentOwners);

		const { container, row } = await buildConfigView(ctx, currentOwner);
		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);
		await modalInteraction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
	}

	// ─── Webhook Modal ─────────────────────────────────────────────────────────

	private async showWebhookModal(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === userId);
		if (!config) {
			await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId(`eocm_webhook_${userId}`)
			.setTitle("Webhook Limits")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("webhook_action").setLabel("Webhook Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.webhookAction)).setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === `eocm_webhook_${userId}` && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const webhookLimit = clampInt(modalInteraction.fields.getTextInputValue("webhook_action"), 0, 100, config.limits.webhookAction);

		const currentOwners = await getExtraOwners(ctx);
		const idx = currentOwners.findIndex((o) => o.userId === userId);
		if (idx === -1) {
			await modalInteraction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		const currentOwner = currentOwners[idx]!;
		currentOwner.limits.webhookAction = webhookLimit;
		await setExtraOwners(ctx, currentOwners);

		const { container, row } = await buildConfigView(ctx, currentOwner);
		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);
		await modalInteraction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
	}

	// ─── Other Modal (webhook, emoji, mention, timeWindow, enforcement) ───────

	private async showOtherModal(ctx: Context, interaction: any, userId: string, msg: any, collector: any): Promise<void> {
		const owners = await getExtraOwners(ctx);
		const config = owners.find((o) => o.userId === userId);
		if (!config) {
			await interaction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const modal = new ModalBuilder()
			.setCustomId(`eocm_other_${userId}`)
			.setTitle("Other Settings")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("emoji_action").setLabel("Emoji Action Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.emojiAction)).setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("mention_limit").setLabel("Mention Limit (0-100)").setStyle(TextInputStyle.Short).setValue(String(config.limits.mentionLimit)).setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("time_window").setLabel("Time Window in seconds (10-3600)").setStyle(TextInputStyle.Short).setValue(String(config.limits.timeWindow)).setRequired(false),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder().setCustomId("enforcement").setLabel("Enforcement (warn/rolestrip/kick/ban)").setStyle(TextInputStyle.Short).setValue(config.enforcement).setRequired(false),
				),
			);

		await interaction.showModal(modal);

		const modalInteraction = await interaction.awaitModalSubmit({ time: COLLECTOR_TIMEOUT, filter: (i: any) => i.customId === `eocm_other_${userId}` && i.user.id === ctx.author!.id }).catch(() => null);
		if (!modalInteraction) return;

		const emojiLimit = clampInt(modalInteraction.fields.getTextInputValue("emoji_action"), 0, 100, config.limits.emojiAction);
		const mentionLimit = clampInt(modalInteraction.fields.getTextInputValue("mention_limit"), 0, 100, config.limits.mentionLimit);
		const timeWindow = clampInt(modalInteraction.fields.getTextInputValue("time_window"), 10, 3600, config.limits.timeWindow);
		const enforcementRaw = modalInteraction.fields.getTextInputValue("enforcement").trim().toLowerCase();
		const validEnforcements = ["warn", "rolestrip", "kick", "ban"] as const;
		const enforcement = validEnforcements.includes(enforcementRaw as any) ? (enforcementRaw as ExtraOwnerConfig["enforcement"]) : config.enforcement;

		const currentOwners = await getExtraOwners(ctx);
		const idx = currentOwners.findIndex((o) => o.userId === userId);
		if (idx === -1) {
			await modalInteraction.reply({ components: [panel("Not Found", "This user is no longer an extra owner.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}
		const currentOwner = currentOwners[idx]!;
		currentOwner.limits.emojiAction = emojiLimit;
		currentOwner.limits.mentionLimit = mentionLimit;
		currentOwner.limits.timeWindow = timeWindow;
		currentOwner.enforcement = enforcement;
		await setExtraOwners(ctx, currentOwners);

		const { container, row } = await buildConfigView(ctx, currentOwner);
		const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`eoc_resetdef_${userId}`).setLabel("Reset Defaults").setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`eoc_removeuser_${userId}`).setLabel("Remove").setStyle(ButtonStyle.Danger),
		);
		await modalInteraction.update({ components: [container, row, secondRow], flags: MessageFlags.IsComponentsV2 });
	}

	// ─── Remove Flow (Command) ────────────────────────────────────────────────

	private async handleRemove(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", true, 1);
		if (!user) return reply(ctx, "Missing User", "Specify a user: `extraowner remove @user`");

		const owners = await getExtraOwners(ctx);
		if (!owners.some((o) => o.userId === user.id)) {
			return reply(ctx, "Not Found", `**${user.username}** is not an extra owner.`);
		}

		const filtered = owners.filter((o) => o.userId !== user.id);
		await setExtraOwners(ctx, filtered);
		return reply(ctx, "Extra Owner Removed", `**${user.username}** has been removed from extra owners.`);
	}

	// ─── Remove Select (from Dashboard button) ────────────────────────────────

	private async showRemoveSelect(ctx: Context, interaction: any, owners: ExtraOwnerConfig[], dashMsg: any, parentCollector: any): Promise<void> {
		const options = await Promise.all(
			owners.map(async (o) => {
				const user = await ctx.client.users.fetch(o.userId).catch(() => null);
				return { label: user?.username ?? "Unknown", description: `ID: ${o.userId}`, value: o.userId };
			}),
		);

		const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder().setCustomId("eor_select").setPlaceholder("Select an extra owner to remove").addOptions(options),
		);

		await interaction.reply({ components: [panel("Remove Extra Owner", "Choose an extra owner to remove."), selectRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

		const selectInteraction = await interaction.channel?.awaitMessageComponent({
			componentType: ComponentType.StringSelect,
			filter: (i: any) => i.customId === "eor_select" && i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		}).catch(() => null);

		if (!selectInteraction) return;

		const selectedUserId = selectInteraction.values[0];
		const currentOwners = await getExtraOwners(ctx);
		const filtered = currentOwners.filter((o) => o.userId !== selectedUserId);
		await setExtraOwners(ctx, filtered);

		const user = await ctx.client.users.fetch(selectedUserId).catch(() => null);
		await selectInteraction.update({ components: [panel("Extra Owner Removed", `**${user?.username ?? selectedUserId}** has been removed from extra owners.`)], flags: MessageFlags.IsComponentsV2 });

		// Refresh the dashboard
		const refreshed = await getExtraOwners(ctx);
		const { container, row } = await buildDashboard(ctx, refreshed);
		await dashMsg.edit({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
	}

	// ─── Reset Flow (Command) ─────────────────────────────────────────────────

	private async handleReset(ctx: Context): Promise<any> {
		const owners = await getExtraOwners(ctx);
		if (owners.length === 0) {
			return reply(ctx, "Extra Owners", "There are no extra owners to clear.");
		}

		const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("eoreset_confirm").setLabel("Confirm Reset").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("eoreset_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		const msg = await ctx.sendMessage({
			components: [panel("Reset Extra Owners", `This will remove all **${owners.length}** extra owner(s). This action cannot be undone.`), confirmRow],
			flags: MessageFlags.IsComponentsV2,
		});
		if (!msg) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		});

		collector.on("collect", async (interaction) => {
			collector.stop();
			if (interaction.customId === "eoreset_confirm") {
				await setExtraOwners(ctx, []);
				await interaction.update({ components: [panel("Extra Owners Cleared", `All **${owners.length}** extra owner(s) have been removed.`)], flags: MessageFlags.IsComponentsV2 });
			} else {
				await interaction.update({ components: [panel("Cancelled", "Reset cancelled. No changes were made.")], flags: MessageFlags.IsComponentsV2 });
			}
		});

		collector.on("end", async (collected, reason) => {
			if (reason === "time") {
				await msg.edit({ components: [panel("Timed Out", "The interaction timed out.")], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
			}
		});
	}

	// ─── Reset Confirm (from Dashboard button) ────────────────────────────────

	private async showResetConfirm(ctx: Context, interaction: any, owners: ExtraOwnerConfig[], dashMsg: any, parentCollector: any): Promise<void> {
		if (owners.length === 0) {
			await interaction.reply({ components: [panel("No Extra Owners", "There are no extra owners to clear.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
			return;
		}

		const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("eoreset_dash_confirm").setLabel("Confirm Reset").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("eoreset_dash_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		await interaction.reply({
			components: [panel("Reset Extra Owners", `This will remove all **${owners.length}** extra owner(s). This action cannot be undone.`), confirmRow],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		});

		const confirmInteraction = await interaction.channel?.awaitMessageComponent({
			componentType: ComponentType.Button,
			filter: (i: any) => (i.customId === "eoreset_dash_confirm" || i.customId === "eoreset_dash_cancel") && i.user.id === ctx.author!.id,
			time: COLLECTOR_TIMEOUT,
		}).catch(() => null);

		if (!confirmInteraction) return;

		if (confirmInteraction.customId === "eoreset_dash_confirm") {
			await setExtraOwners(ctx, []);
			await confirmInteraction.update({ components: [panel("Extra Owners Cleared", `All **${owners.length}** extra owner(s) have been removed.`)], flags: MessageFlags.IsComponentsV2 });

			// Refresh the dashboard
			const refreshed = await getExtraOwners(ctx);
			const { container, row } = await buildDashboard(ctx, refreshed);
			await dashMsg.edit({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
		} else {
			await confirmInteraction.update({ components: [panel("Cancelled", "Reset cancelled. No changes were made.")], flags: MessageFlags.IsComponentsV2 });
		}
	}
}
