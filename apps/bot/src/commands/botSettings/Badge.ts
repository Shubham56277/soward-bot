import type { BadgeAsset, BadgeDefinition, CreateBadgeDefinitionInput, UpdateBadgeDefinitionInput } from "@repo/db";
import { ApplicationCommandOptionType, escapeMarkdown, type User } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { profileBadgeService } from "../../services/profile/ProfileBadgeService";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";

const ACTIONS = ["create", "edit", "delete", "list", "give", "remove", "clear", "show"] as const;
const NO_MENTIONS = { parse: [] as const, repliedUser: false };
const MAX_DEFINITIONS = 15;
const MAX_VISIBLE = 10;
const KEY_PATTERN = /^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const MENTION_PATTERN = /<@!?\d+>|<@&\d+>|<#\d+>|@(everyone|here)/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const IMAGE_PATH_PATTERN = /^images\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/i;

class BadgeInputError extends Error {
	public constructor(public readonly title: string, message: string) {
		super(message);
	}
}

function stringOption(name: string, description: string, required = false, maxLength = 300): any {
	return { name, description, type: ApplicationCommandOptionType.String, required, max_length: maxLength };
}

function userOption(): any {
	return { name: "user", description: "Discord user", type: ApplicationCommandOptionType.User, required: true };
}

function keyOption(): any {
	return stringOption("key", "Lowercase badge key", true, 48);
}

function safe(value: string, limit = 160): string {
	return escapeMarkdown(value).replaceAll("@", "@\u200b").replaceAll("<", "\\<").slice(0, limit);
}

function badgeKey(value: unknown): string {
	const key = String(value ?? "").trim();
	if (!key || key.length > 48 || key !== key.toLowerCase() || !KEY_PATTERN.test(key)) {
		throw new BadgeInputError("Invalid badge key", "Use 1-48 lowercase letters, numbers, underscores, or hyphens; start and end with a letter or number.");
	}
	return key;
}

function text(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
	const result = String(value ?? "").trim();
	if ((!allowEmpty && !result) || result.length > maxLength || CONTROL_PATTERN.test(result) || MENTION_PATTERN.test(result)) {
		throw new BadgeInputError(`Invalid ${label}`, `${label[0]!.toUpperCase()}${label.slice(1)} must be ${allowEmpty ? "0" : "1"}-${maxLength} characters without control characters or mentions.`);
	}
	return result;
}

function priority(value: unknown, fallback = 0): number {
	if (value === undefined || value === null || value === "") return fallback;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
		throw new BadgeInputError("Invalid priority", "Priority must be a whole number from 0 to 10000.");
	}
	return parsed;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	if (value === undefined || value === null || value === "") return fallback;
	if (typeof value === "boolean") return value;
	if (String(value).toLowerCase() === "true") return true;
	if (String(value).toLowerCase() === "false") return false;
	throw new BadgeInputError("Invalid enabled value", "Enabled must be `true` or `false`.");
}

function badgeType(value: unknown, fallback: "static" | "animated" = "static"): "static" | "animated" {
	if (value === undefined || value === null || value === "") return fallback;
	const parsed = String(value).toLowerCase();
	if (parsed !== "static" && parsed !== "animated") {
		throw new BadgeInputError("Invalid badge type", "Type must be `static` or `animated`.");
	}
	return parsed;
}

function expiry(value: unknown): Date | null {
	if (value === undefined || value === null || value === "" || String(value).toLowerCase() === "none") return null;
	const raw = String(value).trim();
	if (!ISO_PATTERN.test(raw)) throw new BadgeInputError("Invalid expiry", "Use a future ISO timestamp such as `2030-01-01T00:00:00Z`, or `none`.");
	const parsed = new Date(raw);
	if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
		throw new BadgeInputError("Invalid expiry", "Expiry must be a valid future ISO timestamp, or `none`.");
	}
	return parsed;
}

function asset(value: unknown): BadgeAsset {
	const raw = String(value ?? "").trim();
	if (!raw || raw.length > 2_048 || CONTROL_PATTERN.test(raw)) {
		throw new BadgeInputError("Invalid badge asset", "Provide an HTTPS image URL or an `images/` project-relative PNG, JPEG, WebP, or GIF path.");
	}
	if (/^https:/i.test(raw)) {
		try {
			const url = new URL(raw);
			if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
			return { kind: "remote", url: url.toString() };
		} catch {
			throw new BadgeInputError("Invalid badge asset", "Remote badge assets must be valid HTTPS URLs without credentials or a custom port.");
		}
	}
	const normalized = raw.replaceAll("\\", "/");
	if (!IMAGE_PATH_PATTERN.test(normalized) || normalized.split("/").includes("..") || normalized.includes("//")) {
		throw new BadgeInputError("Invalid badge asset", "Local assets must be safe `images/` project-relative PNG, JPEG, WebP, or GIF paths with no traversal.");
	}
	return { kind: "local", path: normalized };
}

function definitionExpiry(definition: BadgeDefinition): string {
	return definition.expiresAt ? `<t:${Math.floor(new Date(definition.expiresAt).getTime() / 1_000)}:R>` : "no expiry";
}

export default class Badge extends Command {
	public constructor() {
		super({
			name: "badge",
			description: {
				content: "Developer badge definition and assignment management",
				usage: "badge <create|edit|delete|list|give|remove|clear|show> ...",
				examples: ["badge list", "badge show 123456789012345678", "badge give @user supporter none"],
			},
			category: "botSettings",
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: true, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [
				{
					name: "create", description: "Create a badge definition", type: ApplicationCommandOptionType.Subcommand,
					options: [
						keyOption(), stringOption("name", "Display name", true, 80), stringOption("asset", "HTTPS URL or images/ path", true, 2_048),
						{ name: "priority", description: "Sort priority", type: ApplicationCommandOptionType.Integer, required: false, min_value: 0, max_value: 10_000 },
						{ name: "enabled", description: "Whether the definition is enabled", type: ApplicationCommandOptionType.Boolean, required: false },
						stringOption("type", "static or animated", false, 8), stringOption("expiry", "Future ISO timestamp or none", false, 40),
						stringOption("description", "Badge description", false, 300),
					],
				},
				{
					name: "edit", description: "Edit one or more badge fields", type: ApplicationCommandOptionType.Subcommand,
					options: [
						keyOption(), stringOption("name", "New display name", false, 80), stringOption("asset", "New HTTPS URL or images/ path", false, 2_048),
						stringOption("description", "New description", false, 300),
						{ name: "priority", description: "New sort priority", type: ApplicationCommandOptionType.Integer, required: false, min_value: 0, max_value: 10_000 },
						{ name: "enabled", description: "New enabled state", type: ApplicationCommandOptionType.Boolean, required: false },
						stringOption("type", "static or animated", false, 8), stringOption("expiry", "Future ISO timestamp or none", false, 40),
					],
				},
				{ name: "delete", description: "Delete a badge definition", type: ApplicationCommandOptionType.Subcommand, options: [keyOption()] },
				{ name: "list", description: "List badge definitions", type: ApplicationCommandOptionType.Subcommand },
				{ name: "give", description: "Give a badge to a user", type: ApplicationCommandOptionType.Subcommand, options: [userOption(), keyOption(), stringOption("expiry", "Future ISO timestamp or none", false, 40)] },
				{ name: "remove", description: "Remove a badge from a user", type: ApplicationCommandOptionType.Subcommand, options: [userOption(), keyOption()] },
				{ name: "clear", description: "Clear every badge from a user", type: ApplicationCommandOptionType.Subcommand, options: [userOption()] },
				{ name: "show", description: "Show a user's active badges", type: ApplicationCommandOptionType.Subcommand, options: [userOption()] },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const action = String(ctx.options.getSubCommand(false, 0) ?? "").toLowerCase();
			switch (action) {
				case "create": return await this.create(ctx);
				case "edit": return await this.edit(ctx);
				case "delete": return await this.delete(ctx);
				case "list": return await this.list(ctx);
				case "give": return await this.give(ctx);
				case "remove": return await this.remove(ctx);
				case "clear": return await this.clear(ctx);
				case "show": return await this.show(ctx);
				default: return this.help(ctx);
			}
		} catch (error) {
			if (error instanceof BadgeInputError) return this.notice(ctx, error.title, error.message);
			return settingsFailure(ctx, error, "badge");
		}
	}

	private async create(ctx: Context): Promise<any> {
		const input = this.createInput(ctx);
		const current = await this.definition(input.key);
		if (current) throw new BadgeInputError("Badge already exists", `A definition already uses the key \`${safe(input.key)}\` (version ${current.version}).`);
		const created = await profileBadgeService.create(input);
		return this.notice(ctx, "Badge created", `Created \`${safe(created.key)}\` at priority **${created.sortPriority}** (version ${created.version}).`);
	}

	private createInput(ctx: Context): CreateBadgeDefinitionInput {
		const key = badgeKey(ctx.isInteraction ? ctx.options.getString("key", true) : ctx.args[1]);
		const displayName = text(ctx.isInteraction ? ctx.options.getString("name", true) : ctx.args[2], "display name", 80);
		const badgeAsset = asset(ctx.isInteraction ? ctx.options.getString("asset", true) : ctx.args[3]);
		const rawDescription = ctx.isInteraction ? ctx.options.getString("description", false) : ctx.args.slice(8).join(" ");
		return {
			key, displayName, asset: badgeAsset,
			description: rawDescription ? text(rawDescription, "description", 300) : "",
			sortPriority: priority(ctx.isInteraction ? ctx.options.getInteger("priority", false) : ctx.args[4]),
			enabled: booleanValue(ctx.isInteraction ? ctx.options.getBoolean("enabled", false) : ctx.args[5], true),
			type: badgeType(ctx.isInteraction ? ctx.options.getString("type", false) : ctx.args[6]),
			expiresAt: expiry(ctx.isInteraction ? ctx.options.getString("expiry", false) : ctx.args[7]),
		};
	}

	private async edit(ctx: Context): Promise<any> {
		const key = badgeKey(ctx.isInteraction ? ctx.options.getString("key", true) : ctx.args[1]);
		const current = await this.requireDefinition(key);
		const changes = ctx.isInteraction ? this.slashEdits(ctx) : this.prefixEdit(ctx);
		if (!Object.keys(changes).length) throw new BadgeInputError("Edit required", "Provide at least one field to change: name, asset, description, priority, enabled, type, or expiry.");
		const updated = await profileBadgeService.edit(key, changes, current.version);
		return this.notice(ctx, "Badge updated", `Updated \`${safe(updated.key)}\` using version ${current.version}; current version is ${updated.version}.`);
	}

	private slashEdits(ctx: Context): UpdateBadgeDefinitionInput {
		const changes: UpdateBadgeDefinitionInput = {};
		const name = ctx.options.getString("name", false);
		const assetValue = ctx.options.getString("asset", false);
		const description = ctx.options.getString("description", false);
		const priorityValue = ctx.options.getInteger("priority", false);
		const enabled = ctx.options.getBoolean("enabled", false);
		const type = ctx.options.getString("type", false);
		const expiresAt = ctx.options.getString("expiry", false);
		if (name !== null) changes.displayName = text(name, "display name", 80);
		if (assetValue !== null) changes.asset = asset(assetValue);
		if (description !== null) changes.description = text(description, "description", 300);
		if (priorityValue !== null) changes.sortPriority = priority(priorityValue);
		if (enabled !== null) changes.enabled = booleanValue(enabled, true);
		if (type !== null) changes.type = badgeType(type);
		if (expiresAt !== null) changes.expiresAt = expiry(expiresAt);
		return changes;
	}

	private prefixEdit(ctx: Context): UpdateBadgeDefinitionInput {
		const field = String(ctx.args[2] ?? "").toLowerCase();
		const value = ctx.args.slice(3).join(" ");
		if (!value) throw new BadgeInputError("Edit value required", "Use `badge edit <key> <field> <value...>`." );
		switch (field) {
			case "name": return { displayName: text(value, "display name", 80) };
			case "asset": return { asset: asset(value) };
			case "description": return { description: text(value, "description", 300) };
			case "priority": return { sortPriority: priority(value) };
			case "enabled": return { enabled: booleanValue(value, true) };
			case "type": return { type: badgeType(value) };
			case "expiry": return { expiresAt: expiry(value) };
			default: throw new BadgeInputError("Invalid edit field", "Field must be name, asset, description, priority, enabled, type, or expiry.");
		}
	}

	private async delete(ctx: Context): Promise<any> {
		const key = badgeKey(ctx.isInteraction ? ctx.options.getString("key", true) : ctx.args[1]);
		const current = await this.requireDefinition(key);
		await profileBadgeService.delete(key, current.version);
		return this.notice(ctx, "Badge deleted", `Deleted \`${safe(key)}\` at version ${current.version}.`);
	}

	private async list(ctx: Context): Promise<any> {
		const definitions = await profileBadgeService.listDefinitions();
		if (!definitions.length) return this.notice(ctx, "Badge definitions", "No badge definitions exist.");
		const shown = definitions.slice(0, MAX_DEFINITIONS);
		const now = Date.now();
		const lines = shown.map((item) => {
			const active = item.enabled && (!item.expiresAt || new Date(item.expiresAt).getTime() > now);
			return `\`${safe(item.key, 48)}\` — **${safe(item.displayName, 80)}** · priority ${item.sortPriority} · ${active ? "active" : "inactive"} · ${item.type} · ${definitionExpiry(item)}`;
		});
		const overflow = definitions.length - shown.length;
		return this.send(ctx, settingsPanel("Badge definitions", `${definitions.length} definition${definitions.length === 1 ? "" : "s"}, ordered by active priority.`, [["Definitions", `${lines.join("\n")}${overflow ? `\n-# +${overflow} more definitions` : ""}`]]));
	}

	private async give(ctx: Context): Promise<any> {
		const user = await this.requireUser(ctx);
		const key = badgeKey(ctx.isInteraction ? ctx.options.getString("key", true) : ctx.args[2]);
		await this.requireDefinition(key);
		const expiresAt = expiry(ctx.isInteraction ? ctx.options.getString("expiry", false) : ctx.args[3]);
		await profileBadgeService.give(user.id, key, { grantedBy: ctx.author!.id, grantMetadata: { source: "badge_command" }, expiresAt });
		return this.notice(ctx, "Badge given", `Gave \`${safe(key)}\` to **${safe(user.username, 80)}**${expiresAt ? ` until <t:${Math.floor(expiresAt.getTime() / 1_000)}:F>` : " with no expiry"}.`);
	}

	private async remove(ctx: Context): Promise<any> {
		const user = await this.requireUser(ctx);
		const key = badgeKey(ctx.isInteraction ? ctx.options.getString("key", true) : ctx.args[2]);
		await this.requireDefinition(key);
		const removed = await profileBadgeService.remove(user.id, key);
		return this.notice(ctx, removed ? "Badge removed" : "Badge not assigned", removed ? `Removed \`${safe(key)}\` from **${safe(user.username, 80)}**.` : `**${safe(user.username, 80)}** does not have \`${safe(key)}\`.`);
	}

	private async clear(ctx: Context): Promise<any> {
		const user = await this.requireUser(ctx);
		const removed = await profileBadgeService.clear(user.id);
		return this.notice(ctx, "Badges cleared", removed ? `Removed **${removed}** badge record${removed === 1 ? "" : "s"} from **${safe(user.username, 80)}**.` : `**${safe(user.username, 80)}** has no badges to clear.`);
	}

	private async show(ctx: Context): Promise<any> {
		const user = await this.requireUser(ctx);
		const view = await profileBadgeService.show(user.id, MAX_VISIBLE);
		if (!view.all.length) return this.notice(ctx, `${safe(user.username, 80)}'s badges`, "No active badges are assigned.");
		const lines = view.visible.map(({ definition, assignment, legacy }) => {
			const assignmentExpiry = assignment?.expiresAt ? `<t:${Math.floor(new Date(assignment.expiresAt).getTime() / 1_000)}:R>` : "no assignment expiry";
			return `\`${safe(definition.key, 48)}\` — **${safe(definition.displayName, 80)}** · priority ${definition.sortPriority} · ${legacy ? "legacy" : assignmentExpiry}`;
		});
		return this.send(ctx, settingsPanel(`${safe(user.username, 80)}'s active badges`, `${view.all.length} active assignment${view.all.length === 1 ? "" : "s"}, ordered by priority.`, [["Assigned", `${lines.join("\n")}${view.overflow ? `\n-# +${view.overflow} more active badges` : ""}`]]));
	}

	private async definition(key: string): Promise<BadgeDefinition | null> {
		return (await profileBadgeService.listDefinitions()).find((item) => item.key === key) ?? null;
	}

	private async requireDefinition(key: string): Promise<BadgeDefinition> {
		const definition = await this.definition(key);
		if (!definition) throw new BadgeInputError("Badge not found", `No badge definition exists for \`${safe(key)}\`.`);
		return definition;
	}

	private async requireUser(ctx: Context): Promise<User> {
		const position = ctx.isInteraction ? 0 : 1;
		const selected = ctx.options.getUser("user", false, position);
		let userId = selected?.id;
		if (!ctx.isInteraction && !userId) {
			const raw = String(ctx.args[position] ?? "").trim();
			const match = raw.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
			userId = match?.[1] ?? match?.[2];
		}
		if (!userId) throw new BadgeInputError("User required", "Mention a Discord user or provide a valid 17-20 digit user ID.");
		const user = await ctx.client.users.fetch(userId, { force: true }).catch(() => null);
		if (!user) throw new BadgeInputError("User not found", "Discord could not find that user.");
		return user;
	}

	private help(ctx: Context): Promise<any> {
		return this.send(ctx, settingsPanel("Badge developer commands", `Actions: ${ACTIONS.map((action) => `\`${action}\``).join(" ")}.`, [
			["Create", "`badge create <key> <display-name> <asset> [priority] [enabled] [static|animated] [expiry|none] [description...]`"],
			["Edit", "`badge edit <key> <field> <value...>`"],
			["Assignments", "`badge give <user> <key> [expiry|none]` · `badge remove <user> <key>` · `badge clear <user>` · `badge show <user>`"],
		]));
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return this.send(ctx, settingsPanel(title, body));
	}

	private send(ctx: Context, panel: ReturnType<typeof settingsPanel>): Promise<any> {
		return ctx.sendMessage({ components: [panel], flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
	}
}
