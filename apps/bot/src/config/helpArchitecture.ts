/**
 * helpArchitecture.ts
 *
 * Data-driven help menu structure.
 * Home → Category (one page showing all commands grouped by section)
 */

export interface CommandGroup {
	heading: string;
	commands: string[];
}

export interface Feature {
	key: string;
	label: string;
	description: string;
	groups: CommandGroup[];
	premium?: boolean;
	comingSoon?: boolean;
}

export interface Category {
	key: string;
	label: string;
	emoji: string;
	tagline: string;
	features: Feature[];
}

// ─── Categories ──────────────────────────────────────────────────────────────

export const HELP_CATEGORIES: Category[] = [
	{
		key: "bot-settings",
		label: "Bot Settings",
		emoji: "<:settings:1532817505423327312>",
		tagline: "Personalization, branding, and command prefixes.",
		features: [
			{
				key: "settings-all",
				label: "Bot Settings",
				description: "Personalization, branding, and command prefixes.",
				groups: [
					{ heading: "Identity", commands: ["bot", "profile", "bio", "badge"] },
					{ heading: "Branding", commands: ["customize"] },
					{ heading: "Prefixes", commands: ["prefix", "noprefix"] },
				],
			},
		],
	},
	{
		key: "management",
		label: "Management",
		emoji: "<:Mangement:1532813659905196326>",
		tagline: "Moderate, protect, and configure your server.",
		features: [
			{
				key: "management-all",
				label: "Management",
				description: "Moderate, protect, and configure your server.",
				groups: [
					{ heading: "Member Moderation", commands: ["ban", "unban", "softban", "kick", "timeout", "mute", "unmute", "massban", "unbanall", "warn", "warns", "clearwarn", "note", "snipe"] },
					{ heading: "Channel & Server Control", commands: ["lock", "unlock", "lockall", "unlockall", "hide", "unhide", "hideall", "unhideall", "lockdown", "slowmode", "unslowmode", "nuke", "purge", "clear", "clone", "media"] },
					{ heading: "Roles & Members", commands: ["nick", "nickname", "role", "roleall", "roleicon"] },
					{ heading: "Protection", commands: ["security", "antinuke", "extraowner", "wl", "automod", "antiswear", "badword", "filter"] },
					{ heading: "Configuration", commands: ["logging", "logger", "customrole", "ignoredchannels", "autoresponder"] },
				],
			},
		],
	},
	{
		key: "community",
		label: "Community",
		emoji: "<:community:1532819061426094203>",
		tagline: "Engage, reward, and grow your members.",
		features: [
			{
				key: "community-all",
				label: "Community",
				description: "Engage, reward, and grow your members.",
				groups: [
					{ heading: "Welcome System", commands: ["welcome", "autorole", "autonick"] },
					{ heading: "Tickets", commands: ["ticket"] },
					{ heading: "Giveaways", commands: ["giveaway", "gstart", "gend", "greroll", "glist"] },
					{ heading: "Community Features", commands: ["reaction-role", "leveling"] },
				],
			},
		],
	},
	{
		key: "entertainment",
		label: "Entertainment",
		emoji: "<:entertainment:1532819510854156390>",
		tagline: "Music, voice, and fun for everyone.",
		features: [
			{
				key: "entertainment-all",
				label: "Entertainment",
				description: "Music, voice, and fun for everyone.",
				groups: [
					{ heading: "Music Playback", commands: ["play", "search", "pause", "resume", "stop", "skip", "skipto", "replay", "seek", "autoplay", "247", "play-file", "record", "playlist"] },
					{ heading: "Queue & Controls", commands: ["queue", "nowplaying", "loop", "shuffle", "remove", "clearqueue", "volume", "join", "leave", "music"] },
					{ heading: "Voice", commands: ["voice", "voice-role", "voicemaster", "deafen", "undeafen", "moveall"] },
					{ heading: "Fun & Social", commands: ["hug", "kiss", "slap", "pat", "poke", "wink", "cry", "nom", "facepalm", "8ball", "rps", "coinflip", "ship", "gay", "meme", "fact", "aniquote", "animal", "color", "reverse"] },
				],
			},
		],
	},
	{
		key: "utilities",
		label: "Utilities",
		emoji: "<a:emoji_1:1532800066283114687>",
		tagline: "Information, tools, and server assets.",
		features: [
			{
				key: "utilities-all",
				label: "Utilities",
				description: "Information, tools, and server assets.",
				groups: [
					{ heading: "Server Information", commands: ["serverinfo", "guildinfo", "membercount", "boostcount", "boosters", "emojilist"] },
					{ heading: "User & Lookup", commands: ["info", "pfp", "banner", "roleinfo", "channelinfo", "emojiinfo", "users", "lists"] },
					{ heading: "Server Assets", commands: ["servericon", "serverbanner", "serversplash", "steal", "cloneemoji", "deleteemoji", "renameemoji", "zipemoji", "stickerinfo", "stickerurl", "deletesticker", "zipsticker"] },
					{ heading: "Media", commands: ["messageurl", "attachments"] },
					{ heading: "General", commands: ["ping", "uptime", "botinfo", "stats", "invite", "vote", "help", "afk", "remind", "calc", "ai", "premium"] },
				],
			},
		],
	},
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export const COMMAND_LOCATION: Record<string, { categoryKey: string; featureKey: string }> = (() => {
	const map: Record<string, { categoryKey: string; featureKey: string }> = {};
	for (const category of HELP_CATEGORIES) {
		for (const feature of category.features) {
			for (const group of feature.groups) {
				for (const name of group.commands) {
					map[name] = { categoryKey: category.key, featureKey: feature.key };
				}
			}
		}
	}
	return map;
})();

export function getCategory(key: string): Category | undefined {
	return HELP_CATEGORIES.find(c => c.key === key);
}

export function getFeature(categoryKey: string, featureKey: string): Feature | undefined {
	return getCategory(categoryKey)?.features.find(f => f.key === featureKey);
}
