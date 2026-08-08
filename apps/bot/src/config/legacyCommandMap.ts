import { COMMAND_REGISTRY_BY_NAME, buildUniqueRegistryMap, normalizeRegistryKey } from "./commandRegistry";

export interface LegacyCommandMapping {
	legacyName: string;
	replacement: string;
	prefixCompatibility: boolean;
	keepSlashTemporarily: boolean;
	forward: boolean;
	message: string;
	removeAfter: string;
	reason: string;
}

const migration = (legacyName: string, replacement: string, reason: string): LegacyCommandMapping => ({
	legacyName,
	replacement,
	prefixCompatibility: true,
	keepSlashTemporarily: false,
	forward: true,
	message: `Use \`${replacement}\` next time. Your request was still completed.`,
	removeAfter: "2026-10-01",
	reason,
});

export const LEGACY_COMMANDS: readonly LegacyCommandMapping[] = [
	// Duplicate command consolidations
	migration("badword", "/filter words", "Clearer word-filter naming"),
	migration("logger", "/logging", "Canonical logging name"),
	migration("ignoredchannels", "/ignore channel", "Scoped ignore configuration"),
	migration("media", "/media-only", "Clarifies the channel policy"),
	migration("nick", "/nickname set", "Professional nickname naming"),
	migration("clone", "/channel clone", "Removes an ambiguous root command"),
	migration("roleicon", "/role icon", "Consolidated role commands"),

	// Giveaway consolidation
	migration("gstart", "/giveaway create", "Consolidated giveaway commands"),
	migration("gend", "/giveaway end", "Consolidated giveaway commands"),
	migration("greroll", "/giveaway reroll", "Consolidated giveaway commands"),
	migration("glist", "/giveaway list", "Consolidated giveaway commands"),
	migration("gpause", "/giveaway pause", "Consolidated giveaway commands"),
	migration("gresume", "/giveaway resume", "Consolidated giveaway commands"),
	migration("greq-role", "/giveaway requirements", "Consolidated giveaway requirements"),

	// Voice consolidation
	migration("vcallow", "/voice allow", "Consolidated voice commands"),
	migration("vchide", "/voice hide", "Consolidated voice commands"),
	migration("vckick", "/voice disconnect", "Clearer voice action naming"),
	migration("vckickall", "/voice disconnect-all", "Clearer confirmed mass action"),
	migration("vclimit", "/voice limit", "Consolidated voice commands"),
	migration("vclock", "/voice lock", "Consolidated voice commands"),
	migration("vcmove", "/voice move", "Consolidated voice commands"),
	migration("vcmoveall", "/voice move-all", "Consolidated confirmed mass action"),
	migration("vcpull", "/voice pull", "Consolidated voice commands"),
	migration("vcreject", "/voice reject", "Consolidated voice commands"),
	migration("vcrename", "/voice rename", "Consolidated voice commands"),
	migration("vcunhide", "/voice public", "Clearer voice visibility naming"),
	migration("vcunlock", "/voice unlock", "Consolidated voice commands"),
	migration("voicemaster", "/voice temporary", "Temporary rooms belong to Voice"),

	// Music consolidation
	migration("clearqueue", "/music clear-queue", "Consolidated music commands"),
	migration("skipto", "/music skip-to", "Consolidated music commands"),
	migration("247", "/music always-on", "Clearer premium music naming"),
	migration("playfile", "/music play-file", "Consolidated music commands"),
	migration("nowplaying", "/music now-playing", "Consolidated music commands"),

	// Dev command consolidation
	migration("premiumcode", "/dev premium-code", "Owner tools belong under Dev"),

	// Duplicate root command consolidations
	migration("users", "/list members", "Consolidated list commands"),
	migration("boosters", "/list boosters", "Consolidated list commands"),
	migration("emojilist", "/list emojis", "Consolidated list commands"),
	migration("purge", "/clear", "Consolidated message cleanup"),
	migration("serverbanner", "/banner server", "Merged banner commands"),
	migration("servericon", "/pfp server", "Merged avatar commands"),
	migration("unslowmode", "/slowmode disable", "Consolidated slowmode commands"),
	migration("mute", "/timeout", "Mute is now timeout"),
	migration("unmute", "/untimeout", "Unmute is now untimeout"),
];

export const LEGACY_COMMANDS_BY_NAME = buildUniqueRegistryMap(LEGACY_COMMANDS, (mapping) => mapping.legacyName, "legacy command mapping");

export function replacementRoot(replacement: string): string {
	return replacement.replace(/^\//, "").trim().split(/\s+/, 1)[0] ?? "";
}

export function replacementArguments(replacement: string): string[] {
	return replacement.replace(/^\//, "").trim().split(/\s+/).slice(1);
}

export function validateLegacyCommandMap(mappings: readonly LegacyCommandMapping[] = LEGACY_COMMANDS): string[] {
	const errors: string[] = [];
	const names = new Map<string, string>();
	for (const mapping of mappings) {
		const normalizedName = normalizeRegistryKey(mapping.legacyName);
		const existing = names.get(normalizedName);
		if (existing) {
			errors.push(`Duplicate legacy mapping after normalization: ${mapping.legacyName} conflicts with ${existing}`);
		} else {
			names.set(normalizedName, mapping.legacyName);
		}
		if (!/^[a-z0-9_-]{1,32}$/.test(mapping.legacyName)) {
			errors.push(`Invalid legacy command name: ${mapping.legacyName}`);
		}
		if (COMMAND_REGISTRY_BY_NAME.has(normalizedName)) {
			errors.push(`Legacy command collides with canonical command: ${mapping.legacyName}`);
		}
		const root = normalizeRegistryKey(replacementRoot(mapping.replacement));
		if (!root) {
			errors.push(`Invalid replacement for ${mapping.legacyName}`);
		} else if (!COMMAND_REGISTRY_BY_NAME.has(root)) {
			errors.push(`Unknown replacement root "${root}" for ${mapping.legacyName}`);
		}
	}
	return errors.sort();
}
