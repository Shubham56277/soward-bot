/**
 * helpArchitecture.ts
 *
 * Defines the premium, product-style information architecture for the help
 * system. Six top-level categories, each containing feature cards, each feature
 * containing grouped command sets.
 *
 * Home → Category → Feature → Command
 *
 * This structure is data-driven so new modules (AI, Economy, Leveling,
 * Verification, Starboard, Analytics) can be added without touching Help.ts.
 */

export interface CommandGroup {
	/** Section heading shown on the feature page (e.g. "Setup", "Configuration") */
	heading: string;
	/** Command names belonging to this group, in display order */
	commands: string[];
}

export interface Feature {
	/** Unique key used in select menu values */
	key: string;
	/** Display label */
	label: string;
	/** One-line description shown on the category page */
	description: string;
	/** Grouped commands shown on the feature page */
	groups: CommandGroup[];
	/** Whether this feature is premium-only */
	premium?: boolean;
	/** Optional "coming soon" flag — shows in UI but not selectable */
	comingSoon?: boolean;
}

export interface Category {
	/** Unique key used in select menu values */
	key: string;
	/** Display label */
	label: string;
	/** Emoji prefix — used in the category select menu shown on the Home page, keep in sync with homeView */
	emoji: string;
	/** Short tagline shown on home + category header */
	tagline: string;
	/** Features contained in this category */
	features: Feature[];
}

// ─── Category & Feature definitions ──────────────────────────────────────────

export const HELP_CATEGORIES: Category[] = [
	{
		key: "bot-settings",
		label: "Bot Settings",
		emoji: "⚙️",
		tagline: "Profiles, premium branding, and command prefixes.",
		features: [
			{
				key: "profiles",
				label: "Profiles",
				description: "Personal bios and cosmetic profile badges.",
				groups: [{ heading: "Profile", commands: ["bot", "profile", "bio", "badge"] }],
			},
			{
				key: "branding",
				label: "Premium Branding",
				description: "Safely manage the bot account avatar, application bio, and banner.",
				premium: true,
				groups: [{ heading: "Customize", commands: ["customize"] }],
			},
			{
				key: "prefixes",
				label: "Prefixes",
				description: "Manage the command prefixes accepted in this server.",
				groups: [
					{ heading: "Prefix", commands: ["prefix"] },
					{ heading: "No Prefix", commands: ["noprefix"] },
				],
			},
		],
	},
	{
		key: "management",
		label: "Management",
		emoji: "🛡",
		tagline: "Moderate, protect, and configure your server.",
		features: [
			{
				key: "moderation",
				label: "Moderation",
				description: "Manage members, punishments, and enforcement.",
				groups: [
					{ heading: "Punishments", commands: ["ban", "kick", "mute", "unmute", "timeout", "softban", "tempban", "massban", "unban", "unbanall"] },
					{ heading: "Warnings & Notes", commands: ["warn", "warns", "clearwarn", "note"] },
					{ heading: "Channel Control", commands: ["lock", "unlock", "lockall", "unlockall", "hide", "unhide", "hideall", "unhideall", "lockdown", "slowmode", "unslowmode", "nuke"] },
					{ heading: "Members & Roles", commands: ["nick", "nickname", "role", "roleall", "roleicon"] },
					{ heading: "Purge", commands: ["purge", "clear", "clone", "media"] },
				],
			},
			{
				key: "security",
				label: "Security",
				description: "Protect against nukes, raids, and permission abuse.",
				groups: [
					{ heading: "Core", commands: ["antinuke", "security"] },
					{ heading: "Extra Owners", commands: ["extraowner"] },
				],
			},
			{
				key: "automod",
				label: "Automod",
				description: "Automatic spam, link, and word filtering.",
				groups: [
					{ heading: "Configuration", commands: ["automod", "antiswear"] },
					{ heading: "Word Filter", commands: ["badword", "filter"] },
				],
			},
			{
				key: "logging",
				label: "Logging",
				description: "Server audit and event logging.",
				groups: [
					{ heading: "Setup", commands: ["logging", "logger"] },
				],
			},
			{
				key: "settings",
				label: "Server Configuration",
				description: "Configure prefix, roles, and server behaviour.",
				groups: [
					{ heading: "General", commands: ["customrole", "ignoredchannels", "autoresponder"] },
				],
			},
		],
	},
	{
		key: "community",
		label: "Community",
		emoji: "👥",
		tagline: "Engage and grow your members.",
		features: [
			{
				key: "tickets",
				label: "Tickets",
				description: "Support ticket panels and management.",
				groups: [
					{ heading: "Tickets", commands: ["ticket"] },
				],
			},
			{
				key: "giveaways",
				label: "Giveaways",
				description: "Host and manage giveaways.",
				groups: [
					{ heading: "Giveaways", commands: ["giveaway", "gstart", "gend", "greroll", "glist"] },
				],
			},
			{
				key: "greetings",
				label: "Welcome & Farewell",
				description: "Greet new members and say goodbye.",
				groups: [
					{ heading: "Greetings", commands: ["welcome", "autorole", "autonick"] },
				],
			},
			{
				key: "reactionroles",
				label: "Reaction Roles",
				description: "Self-assignable roles via reactions.",
				comingSoon: true,
				groups: [],
			},
			{
				key: "leveling",
				label: "Leveling",
				description: "Reward active members with levels.",
				comingSoon: true,
				groups: [],
			},
		],
	},
	{
		key: "entertainment",
		label: "Entertainment",
		emoji: "🎵",
		tagline: "Music, voice, and fun for everyone.",
		features: [
			{
				key: "music",
				label: "Music",
				description: "High-quality music playback.",
				groups: [
					{ heading: "Playback", commands: ["play", "search", "pause", "resume", "stop", "skip", "skipto", "replay", "seek"] },
					{ heading: "Queue", commands: ["queue", "nowplaying", "loop", "shuffle", "remove", "clearqueue", "volume"] },
					{ heading: "Session", commands: ["join", "leave", "music"] },
					{ heading: "Premium", commands: ["autoplay", "247", "play-file", "record", "playlist"] },
				],
			},
			{
				key: "voice",
				label: "Voice",
				description: "Voice channel controls.",
				groups: [
					{ heading: "Voice", commands: ["voice", "voice-role"] },
					{ heading: "Moderation", commands: ["deafen", "undeafen", "moveall"] },
				],
			},
			{
				key: "voicemaster",
				label: "Voice Master",
				description: "Temporary auto-managed voice rooms.",
				groups: [
					{ heading: "Voice Master", commands: ["voicemaster"] },
				],
			},
			{
				key: "fun",
				label: "Fun",
				description: "Games, reactions, and playful commands.",
				groups: [
					{ heading: "Reactions", commands: ["hug", "kiss", "slap", "pat", "poke", "wink", "cry", "nom", "facepalm"] },
					{ heading: "Games", commands: ["8ball", "rps", "coinflip", "ship", "gay"] },
					{ heading: "Random", commands: ["meme", "fact", "aniquote", "animal", "color", "reverse"] },
				],
			},
		],
	},
	{
		key: "utilities",
		label: "Utilities",
		emoji: "🛠",
		tagline: "Tools and information at your fingertips.",
		features: [
			{
				key: "information",
				label: "Information",
				description: "Look up users, roles, servers, and more.",
				groups: [
					{ heading: "Server", commands: ["guildinfo", "serverinfo", "membercount", "boostcount", "boosters", "servericon", "serverbanner", "emojilist", "firstmessage"] },
					{ heading: "User", commands: ["userinfo", "avater", "banner", "joinedat"] },
					{ heading: "Lookup", commands: ["roleinfo", "channelinfo", "emojiinfo", "users", "lists"] },
				],
			},
			{
				key: "tools",
				label: "Server Tools",
				description: "Emojis, media, and management helpers.",
				groups: [
					{ heading: "Emojis", commands: ["addemoji", "zipemoji"] },
					{ heading: "Media", commands: ["mediaonly", "snipe"] },
				],
			},
			{
				key: "general",
				label: "General",
				description: "Everyday utility commands.",
				groups: [
					{ heading: "Bot", commands: ["ping", "uptime", "botinfo", "stats", "invite", "vote", "help"] },
					{ heading: "Personal", commands: ["afk", "remind", "calc"] },
					{ heading: "Premium", commands: ["ai", "premium"] },
				],
			},
		],
	},

];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/** Map of command name → { category, feature } for fast reverse lookup */
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
