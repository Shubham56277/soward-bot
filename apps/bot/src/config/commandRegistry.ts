import type { PermissionResolvable } from "discord.js";

export const COMMAND_CATEGORIES = [
	"general", "moderation", "security", "logging", "automations", "welcome", "roles", "tickets",
	"utility", "embeds", "voice", "giveaways", "responders", "fun", "settings", "music", "premium", "developer",
] as const;

export type CommandCategory = typeof COMMAND_CATEGORIES[number];

export interface CommandRegistryEntry {
	name: string;
	label: string;
	category: CommandCategory;
	description: string;
	implemented: boolean;
	slash: boolean;
	prefixCompatibility: boolean;
	premium: boolean;
	developerOnly: boolean;
	userPermissions: PermissionResolvable[];
	clientPermissions: PermissionResolvable[];
	cooldownSeconds: number;
	legacyNames: string[];
	replacement?: string;
	deprecated: boolean;
	removeAfter?: string;
	publicHelp: boolean;
	keywords: string[];
	group?: string;
	subcommands?: string[];
}

type RegistrySeed = Pick<CommandRegistryEntry, "name" | "category" | "description"> & Partial<Omit<CommandRegistryEntry, "name" | "category" | "description">>;

const entry = (seed: RegistrySeed): CommandRegistryEntry => ({
	label: seed.name.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
	implemented: false,
	slash: true,
	prefixCompatibility: true,
	premium: false,
	developerOnly: false,
	userPermissions: [],
	clientPermissions: ["ViewChannel", "SendMessages"],
	cooldownSeconds: 3,
	legacyNames: [],
	deprecated: false,
	publicHelp: seed.category !== "developer",
	keywords: [],
	...seed,
});

const implemented = new Set([
	"help", "ping", "uptime", "botinfo", "serverinfo", "userinfo", "avatar", "banner", "membercount", "boostcount",
	"joinedat", "roleinfo", "channelinfo", "invite", "stats", "vote", "list", "afk", "ban", "unban", "softban", "kick",
	"timeout", "untimeout", "warn", "warnings", "nickname", "slowmode", "lock", "unlock", "hide", "unhide", "clear",
	"channel", "role", "quarantine", "security", "antinuke", "mainrole", "trusted", "ignore", "coowner",
	"logging", "automod", "filter", "autorole", "notifier", "autodelete",
	"autoresponder", "autoreact", "welcome", "customrole", "ticket", "media-only", "sticky",
	"reaction-role", "variables", "embed", "voice", "voice-role",
	"giveaway", "music", "fun", "bot", "prefix", "premium",
	"ai", "record", "dev",
]);

const seeds: RegistrySeed[] = [
	// === GENERAL (14) ===
	["help", "general", "Browse commands and detailed usage"],
	["ping", "general", "Check gateway and API latency"],
	["uptime", "general", "Show how long the bot has been online"],
	["botinfo", "general", "Show information about the bot"],
	["serverinfo", "general", "Show detailed server information"],
	["userinfo", "general", "Show information about a member"],
	["avatar", "general", "Show a user or server avatar"],
	["banner", "general", "Show a user or server banner"],
	["membercount", "general", "Show the server member count"],
	["boostcount", "general", "Show server boost information"],
	["joinedat", "general", "Show when a member joined"],
	["roleinfo", "general", "Show information about a role"],
	["channelinfo", "general", "Show information about a channel"],
	["invite", "general", "Get the bot invite link"],
	["stats", "general", "Show runtime and network statistics"],
	["vote", "general", "Open bot voting links"],
	["list", "general", "Browse server members and resources", { subcommands: ["members", "boosters", "emojis", "roles", "bots", "bans"] }],
	["afk", "general", "Manage your AFK status"],

	// === MODERATION (18) ===
	["ban", "moderation", "Ban a member safely"],
	["unban", "moderation", "Remove a server ban"],
	["softban", "moderation", "Purge recent messages by ban and immediate unban"],
	["kick", "moderation", "Remove a member from the server"],
	["timeout", "moderation", "Temporarily restrict a member"],
	["untimeout", "moderation", "Remove a member timeout"],
	["warn", "moderation", "Create a warning case"],
	["warnings", "moderation", "Review and manage warning cases"],
	["nickname", "moderation", "Set or reset a member nickname", { subcommands: ["set", "reset"] }],
	["slowmode", "moderation", "Configure channel slowmode", { subcommands: ["set", "disable"] }],
	["lock", "moderation", "Lock a channel"],
	["unlock", "moderation", "Unlock a channel"],
	["hide", "moderation", "Hide a channel"],
	["unhide", "moderation", "Reveal a channel"],
	["clear", "moderation", "Remove messages using safe filters", { subcommands: ["all", "user", "bots", "links", "attachments", "text"] }],
	["channel", "moderation", "Manage server channels", { subcommands: ["clone", "lock", "unlock", "hide", "unhide"] }],
	["role", "moderation", "Manage server roles", { subcommands: ["add", "remove", "create", "delete", "edit", "icon", "info"] }],
	["quarantine", "moderation", "Manage member quarantine"],

	// === SECURITY (5) ===
	["security", "security", "Show active server protections"],
	["antinuke", "security", "Configure destructive-action protection"],
	["mainrole", "security", "Manage the server main role"],
	["trusted", "security", "Manage trusted security members"],
	["ignore", "security", "Manage command ignore rules", { subcommands: ["channel", "role", "user"] }],
	["coowner", "security", "Manage owner-authorized co-owners"],

	// === LOGGING (1) ===
	["logging", "logging", "Configure server event logging"],

	// === AUTOMATIONS (5) ===
	["automod", "automations", "Configure automatic moderation"],
	["filter", "automations", "Manage server word filters", { subcommands: ["words", "status", "test"] }],
	["autorole", "automations", "Configure automatic roles", { subcommands: ["add", "remove", "list", "reset"] }],
	["notifier", "automations", "Configure server notifications"],
	["autodelete", "automations", "Configure automatic message deletion"],

	// === RESPONDERS (2) ===
	["autoresponder", "responders", "Configure automatic responses"],
	["autoreact", "responders", "Configure automatic reactions"],

	// === WELCOME (1) ===
	["welcome", "welcome", "Configure member welcome messages"],

	// === ROLES (1) ===
	["customrole", "roles", "Configure managed custom roles"],

	// === TICKETS (1) ===
	["ticket", "tickets", "Configure and operate support tickets"],

	// === UTILITY (3) ===
	["media-only", "utility", "Manage media-only channels", { subcommands: ["add", "remove", "list"] }],
	["sticky", "utility", "Manage sticky messages"],
	["reaction-role", "utility", "Manage reaction role panels"],
	["variables", "utility", "Browse supported message variables"],

	// === EMBEDS (1) ===
	["embed", "embeds", "Create and manage embeds"],

	// === VOICE (2) ===
	["voice", "voice", "Manage voice channels and temporary rooms", {
		subcommands: ["allow", "hide", "disconnect", "disconnect-all", "limit", "lock", "move", "move-all", "pull", "reject", "rename", "public", "unlock", "temporary"],
	}],
	["voice-role", "voice", "Configure temporary voice roles"],

	// === GIVEAWAYS (1) ===
	["giveaway", "giveaways", "Create and manage giveaways", {
		subcommands: ["create", "end", "reroll", "list", "pause", "resume", "requirements"],
	}],

	// === MUSIC (1) ===
	["music", "music", "Play and manage music", { cooldownSeconds: 2 }],

	// === FUN (1) ===
	["fun", "fun", "Run social and text activities"],

	// === SETTINGS (3) ===
	["bot", "settings", "Manage bot settings for this server"],
	["prefix", "settings", "Manage server command prefixes"],
	["premium", "premium", "Manage premium access", { subcommands: ["status", "activate", "features"] }],

	// === PREMIUM (2) ===
	["ai", "premium", "Use the premium AI assistant", { premium: true }],
	["record", "premium", "Record a voice session", { premium: true }],

	// === DEVELOPER (1) ===
	["dev", "developer", "Bot-owner maintenance tools", {
		developerOnly: true,
		publicHelp: false,
		subcommands: ["premium-code", "no-prefix", "diagnostics", "sync", "reload"],
	}],
].map((seed) => {
	const [name, category, description, extra] = seed as unknown as [string, CommandCategory, string, Partial<CommandRegistryEntry> | undefined];
	return { name, category, description, ...(extra ?? {}) };
});

export const COMMAND_REGISTRY: readonly CommandRegistryEntry[] = seeds.map((seed) => entry({
	...seed,
	implemented: implemented.has(seed.name),
}));

export const COMMAND_REGISTRY_BY_NAME = new Map(COMMAND_REGISTRY.map((command) => [command.name, command]));

/**
 * Validate the entire command registry for duplicates, invalid names, and limit violations.
 * Returns an array of error strings. Empty array = no errors.
 */
export function validateCommandRegistry(): string[] {
	const errors: string[] = [];
	const names = new Set<string>();
	const nameSet = new Set<string>();
	let rootCommandCount = 0;

	for (const command of COMMAND_REGISTRY) {
		// Validate name format
		if (!/^[a-z0-9_-]{1,32}$/.test(command.name)) {
			errors.push(`Invalid canonical command name: "${command.name}"`);
		}

		// Check for duplicate names
		if (names.has(command.name)) {
			errors.push(`Duplicate canonical command: "${command.name}"`);
		}
		names.add(command.name);

		// Validate description - 100 char limit for Discord
		if (!command.description || command.description.length > 100) {
			errors.push(`Invalid description for "${command.name}": must be 1-100 characters`);
		}

		// Count root commands (only those with slash: true)
		if (command.slash) {
			rootCommandCount++;
		}

		// Check for duplicate names in nameSet (catch re-registrations)
		if (command.slash) {
			const lowerName = command.name.toLowerCase();
			if (nameSet.has(lowerName)) {
				errors.push(`Duplicate root command name after normalization: "${command.name}"`);
			}
			nameSet.add(lowerName);
		}
	}

	// Validate subcommand names against known subcommand lists
	// (basic check that subcommand names are lowercase alphanumeric)
	for (const command of COMMAND_REGISTRY) {
		if (command.subcommands) {
			for (const sub of command.subcommands) {
				if (!/^[a-z0-9_-]{1,32}$/.test(sub)) {
					errors.push(`Invalid subcommand name "${sub}" in "${command.name}"`);
				}
			}
		}
	}

	return errors;
}

/**
 * Get the current root command count.
 */
export function getRootCommandCount(): number {
	return COMMAND_REGISTRY.filter((cmd) => cmd.slash).length;
}

/**
 * Print registry summary for startup diagnostics.
 */
export function printRegistrySummary(): void {
	const total = COMMAND_REGISTRY.length;
	const slashCount = getRootCommandCount();
	const grouped = COMMAND_REGISTRY.filter((cmd) => cmd.subcommands && cmd.subcommands.length > 0);
	const deprecated = COMMAND_REGISTRY.filter((cmd) => cmd.deprecated);
	const devOnly = COMMAND_REGISTRY.filter((cmd) => cmd.developerOnly);
	const premium = COMMAND_REGISTRY.filter((cmd) => cmd.premium);

	console.log(`[Registry] ${total} entries · ${slashCount} root commands · ${grouped.length} grouped`);
	console.log(`[Registry] ${deprecated.length} deprecated · ${devOnly.length} dev-only · ${premium.length} premium`);
	if (slashCount > 90) {
		console.warn(`[Registry] ⚠️ Root command count (${slashCount}) exceeds 90! Sync may fail.`);
	}
}
