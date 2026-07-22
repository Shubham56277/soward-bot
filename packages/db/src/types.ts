import { schema } from ".";

export type GuildType = typeof schema.guilds.$inferInsert;
export type UserType = typeof schema.users.$inferInsert;
export type AFKType = typeof schema.AFK.$inferInsert;
export type AntiNukeType = typeof schema.AntiNuke.$inferInsert;
export type AutoModType = typeof schema.AutoMod.$inferInsert;
export type VoiceSettingsType = typeof schema.voiceSettings.$inferInsert;
export type RoomType = typeof schema.rooms.$inferInsert;
export type VoiceCreatorType = typeof schema.voiceCreators.$inferInsert;
export type GiveawaysType = typeof schema.giveaways.$inferInsert;
export type AutoresponderType = typeof schema.autoResponder.$inferInsert;
export type CustomRoleType = typeof schema.customRoles.$inferInsert;
export type WelcomeType = typeof schema.welcome.$inferInsert;
export type AutoRoleType = typeof schema.autoRole.$inferInsert;
export type LoggerType = typeof schema.logger.$inferInsert;
export type TicketConfigType = typeof schema.ticketConfigs.$inferSelect;
export type TicketType = typeof schema.tickets.$inferInsert;
export type WarningsType = typeof schema.warnings.$inferInsert;
export type AutoNickType = typeof schema.autoNick.$inferInsert;
export type MediaChannelType = typeof schema.mediaChannel.$inferInsert;
export type VoiceChannelRoleType = typeof schema.voiceChannelRole.$inferInsert;
export type IgnoredChannelsType = typeof schema.ignoredChannels.$inferInsert;
export type blacklistType = typeof schema.blacklist.$inferInsert;
export type PremiumType = typeof schema.premium.$inferInsert;
export type PremiumCodeType = typeof schema.premiumCodes.$inferInsert;

export type Channel = {
	channelId: string;
};

export type ID = {
	id: string;
};

export type AntiNukeChannel = {
	type: "delete" | "create" | "update";
	limit: number;
	enabled: boolean;
	action: "kick" | "ban" | "role-remove";
};

export type AntiNukeMember = {
	type: "kick" | "ban" | "unban" | "update";
	limit: number;
	enabled: boolean;
	action: "kick" | "ban" | "role-remove";
};

export type Roles = {
	role: string;
	aliase: string;
};


export type EmbedType = {
	title?: string;
	description?: string;
	footer?: {
		text: string;
		icon_url?: string;
	};
	color?: number;
	thumbnail?: {
		url?: string;
	};
	image?: {
		url: string;
	};
	author?: {
		name?: string;
		icon_url?: string;
	}
	fields?: Array<{ name: string; value: string; inline: boolean }>;
	timestamp?: string;
};
