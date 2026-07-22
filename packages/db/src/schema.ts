import { env } from "@repo/env";
import { relations } from "drizzle-orm";
import { pgTable, json, text, integer, boolean, timestamp, bigint, jsonb } from "drizzle-orm/pg-core";
import { AntiNukeChannel, AntiNukeMember, EmbedType, ID, Roles } from "./types";

export const moderationCases = pgTable("moderation_cases", {
	id: text("id").primaryKey(),
	caseId: integer("case_id").notNull(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	targetId: text("target_id").notNull(),
	moderatorId: text("moderator_id").notNull(),
	action: text("action").notNull().$type<"warn" | "kick" | "ban" | "timeout" | "unban" | "mute" | "unmute" | "softban">(),
	reason: text("reason").notNull(),
	duration: bigint("duration", { mode: "number" }),
	extra: jsonb("extra"),
	resolved: boolean("resolved").default(false),
	resolvedBy: text("resolved_by"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	resolution: text("resolution"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const guild_premium = pgTable("guild_premium", {
	guildId: text("guild_id")
		.primaryKey()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	isPremium: boolean("is_premium").default(false),
	premiumSince: timestamp("premium_since", { withTimezone: true }),
	premiumUntil: timestamp("premium_until", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const coowners = pgTable("coowners", {
	guildId: text("guild_id")
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" })
		.notNull(),
	userId: text("user_id").notNull(),
	addedBy: text("added_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trusted_members = pgTable("trusted_members", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	userId: text("user_id").notNull(),
	addedBy: text("added_by").notNull(),
	scope: text("scope").default("global").$type<"global" | "antinuke" | "automod">(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ignore_rules = pgTable("ignore_rules", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	type: text("type").notNull().$type<"channel" | "role" | "user">(),
	targetId: text("target_id").notNull(),
	features: text("features").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const main_roles = pgTable("main_roles", {
	guildId: text("guild_id")
		.primaryKey()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	roleId: text("role_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const security_snapshots = pgTable("security_snapshots", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	type: text("type").notNull(),
	data: jsonb("data").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const panic_mode_configs = pgTable("panic_mode_configs", {
	guildId: text("guild_id")
		.primaryKey()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	enabled: boolean("enabled").default(false),
	lockdownRoles: text("lockdown_roles").array().default([]),
	notifyChannel: text("notify_channel"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const automod_rules = pgTable("automod_rules", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	type: text("type").notNull(),
	enabled: boolean("enabled").default(true),
	action: text("action").notNull(),
	punishment: text("punishment"),
	duration: bigint("duration", { mode: "number" }),
	threshold: integer("threshold"),
	config: jsonb("config"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const automod_exemptions = pgTable("automod_exemptions", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	ruleId: text("rule_id").notNull(),
	type: text("type").notNull().$type<"channel" | "role" | "user">(),
	targetId: text("target_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auto_reactions = pgTable("auto_reactions", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id"),
	trigger: text("trigger").notNull(),
	reactions: text("reactions").array().notNull(),
	enabled: boolean("enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notifiers = pgTable("notifiers", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	type: text("type").notNull(),
	message: text("message"),
	enabled: boolean("enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auto_delete_rules = pgTable("auto_delete_rules", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	delay: integer("delay").notNull().default(10),
	filter: jsonb("filter"),
	enabled: boolean("enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sticky_messages = pgTable("sticky_messages", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	messageId: text("message_id").notNull(),
	content: text("content").notNull(),
	embed: jsonb("embed"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reaction_roles = pgTable("reaction_roles", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	messageId: text("message_id").notNull(),
	emoji: text("emoji").notNull(),
	roleId: text("role_id").notNull(),
	mode: text("mode").default("normal").$type<"normal" | "unique" | "verify">(),
	enabled: boolean("enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reaction_role_options = pgTable("reaction_role_options", {
	id: text("id").primaryKey(),
	reactionRoleId: text("reaction_role_id")
		.notNull()
		.references(() => reaction_roles.id, { onDelete: "cascade" }),
	emoji: text("emoji").notNull(),
	roleId: text("role_id").notNull(),
	label: text("label"),
	description: text("description"),
});

export const saved_embeds = pgTable("saved_embeds", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	name: text("name").notNull(),
	embed: jsonb("embed").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ticket_panels = pgTable("ticket_panels", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	name: text("name").notNull(),
	description: text("description"),
	channelId: text("channel_id").notNull(),
	categoryId: text("category_id").notNull(),
	messageId: text("message_id"),
	supportRoles: text("support_roles").array().notNull().default([]),
	maxTickets: integer("max_tickets").default(1),
	enabled: boolean("enabled").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const welcome_configs = pgTable("welcome_configs", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	type: text("type").notNull().$type<"join" | "leave" | "boost">(),
	channelId: text("channel_id").notNull(),
	message: text("message"),
	embed: jsonb("embed"),
	enabled: boolean("enabled").default(true),
	premium: boolean("premium").default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const guilds = pgTable("guilds", {
	guildId: text("guild_id").primaryKey(),
	prefix: text("prefix").default(env.PREFIX),
	language: text("language").default("en"),
	twoFourSeven: json("247").$type<{ channelId: string }>(),
	customRoles: json("custom_roles").$type<ID[]>(),
	ignoreCommands: json("ignore_commands").$type<string[]>(),
	giveawaysManagerRole: text("giveaways_manager_role"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$onUpdate(() => new Date()),
});

export const users = pgTable("users", {
	userId: text("user_id").primaryKey(),
	noPrefix: boolean("no_prefix").default(false),
	noPrefixExpiresAt: timestamp("no_prefix_expires_at", { withTimezone: true }),
	level: integer("level").default(0),
	xp: integer("xp").default(0),
	relationships: text("relationships").default("single").$type<"single" | "married">(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$onUpdate(() => new Date()),
});

export const AFK = pgTable("afk", {
	userId: text("user_id")
		.references(() => users.userId, { onDelete: "cascade", onUpdate: "cascade" })
		.notNull(),
	reason: text("reason").default("AFK"),
	global: boolean("global").default(false),
	guildId: text("guild_id").references(() => guilds.guildId),
	mentionBy: json().$type<ID[]>().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$onUpdate(() => new Date()),
});

export const AntiNuke = pgTable("anti_nuke", {
	guildId: text("guild_id")
		.primaryKey()
		.references(() => guilds.guildId, {
			onDelete: "cascade",
			onUpdate: "cascade",
		}),
	enabled: boolean("enabled").default(false),
	admin: text("admin"),
	trustedUsers: json("trustedUsers").$type<ID[]>(),
	// Anti-Channel protections
	channel: json("channel").$type<AntiNukeChannel[]>(),
	// Anti-Member protections
	member: json("member").$type<AntiNukeMember[]>(),
	// Anti-Emoji protections
	emoji: json("emoji").$type<AntiNukeChannel[]>(),
	// Anti-Role protections
	role: json("role").$type<AntiNukeChannel[]>(),
	// Anti-Webhook protections
	webhook: json("webhook").$type<AntiNukeChannel[]>(),
	// Anti-sticker protections
	sticker: json("sticker").$type<AntiNukeChannel[]>(),
	// Anti-Nuke guild protections
	guild: json("guild").$type<AntiNukeChannel[]>(),
	// Anti-Nuke memtion protections
	mention: boolean("mention").default(false),
	// Anti-Nuke gatekeeper
	gateKeeper: boolean("gatekeeper").default(false),
	// Optional: Timestamps
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const AutoMod = pgTable("automod", {
	guildId: text("guild_id")
		.primaryKey()
		.references(() => guilds.guildId, {
			onDelete: "cascade",
			onUpdate: "cascade",
		}),
	enabled: boolean("enabled").default(false),
	spam: json("spam")
		.$type<{
			enabled: boolean;
			action: "ban" | "timeout" | "kick";
			ignoredChannels: ID[];
			ignoredRoles: ID[];
			ignoredUsers: ID[];
			spamLimit: number;
			maxEmojis: number;
		}>()
		.default({
			enabled: false,
			action: "timeout",
			ignoredChannels: [],
			ignoredRoles: [],
			ignoredUsers: [],
			spamLimit: 7,
			maxEmojis: 10,
		}),
	link: json("link")
		.$type<{
			enabled: boolean;
			allowedDomains: string[];
			ignoredChannels: ID[];
			ignoredRoles: ID[];
			ignoredUsers: ID[];
			action: "delete" | "warn" | "timeout" | "kick" | "ban";
		}>()
		.default({
			enabled: false,
			allowedDomains: [],
			ignoredChannels: [],
			ignoredRoles: [],
			ignoredUsers: [],
			action: "delete",
		}),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$onUpdate(() => new Date()),
});

export const voiceCreators = pgTable("voiceCreators", {
	guildId: text("guild_id")
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" })
		.notNull(),
	textChannelId: text("textChannelId").notNull(),
	voiceChannelId: text("voiceChannelId").notNull(),
	categoryId: text("categoryId").notNull(),
});
export const premium = pgTable("premium", {
	userId: text("user_id")
		.primaryKey()
		.references(() => users.userId),
	isPremium: boolean("is_premium").default(false),
	premiumSince: timestamp("premium_since", { withTimezone: true }),
	premiumUntil: timestamp("premium_until", { withTimezone: true }),
	
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.$onUpdate(() => new Date()),
});
export const premiumCodes = pgTable("premium_codes", {
	codeHash: text("code_hash").primaryKey(),
	durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
	createdBy: text("created_by").notNull(),
	redeemedBy: text("redeemed_by"),
	redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const rooms = pgTable("rooms", {
	id: text("id").primaryKey(),
	voiceChannelId: text("voiceChannelId").notNull(),
	ownerId: text("ownerId").notNull(),
	cooldown: integer("cooldown").notNull(),
});
export const voiceSettings = pgTable("voice_settings", {
	guildId: text("guild_id")
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" })
		.notNull(),
	userId: text("userId").notNull(),
	name: text("name").notNull().default("0"),
	userLimit: integer("userLimit").notNull().default(10),
	locked: boolean("locked").notNull().default(false),
	visible: boolean("visible").notNull().default(true),
	leave: bigint({ mode: "number" }).notNull().default(0),
});

export const giveaways = pgTable("giveaways", {
	id: text("id").primaryKey(),
	guildId: text("guildId").notNull(),
	channelId: text("channelId").notNull(),
	hostedBy: text("hostedBy").notNull(),
	messageId: text("messageId").notNull(),
	prize: text("prize").notNull(),
	winners: integer("winners").notNull(),
	duration: bigint({ mode: "number" }).notNull(),
	ended: boolean("ended").notNull().default(false),
	endAt: timestamp("endAt", { withTimezone: true }).notNull(),
	participants: json("participants").$type<ID[]>(),
	paused: boolean("paused").notNull().default(false),
	createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updatedAt", { withTimezone: true })
		.notNull()
		.$onUpdate(() => new Date()),
});

export const autoResponder = pgTable("auto_responder", {
	id: text("id").primaryKey(),
	guildId: text("guild_id").notNull(),
	name: text("name").notNull(),
	trigger: text("trigger").notNull(),
	response: text("response").notNull(),
	useRegex: boolean("use_regex").default(false),
	reactionEmoji: text("reaction_emoji"),
	cooldown: integer("cooldown").default(10),
	createdAt: timestamp("created_at").defaultNow(),
	channelId: text("channel_id"),
	enabled: boolean("enabled").default(true),
});

export const roleButtons = pgTable("role_buttons", {
	id: text("id").primaryKey(), // messageId
	guildId: text("guild_id").notNull(),
	roles: text("roles").array().notNull(), // Stores role IDs
	labels: text("labels").array().notNull(), // Button labels
	emojis: text("emojis").array().notNull(), // Emojis
});

export const welcome = pgTable("welcome", {
	guildId: text("guild_id").primaryKey(),
	channelId: text("channel_id").notNull(),
	message: text("message").notNull(),
	type: text("type").notNull().$type<"embed" | "text" | "card" | "embed-text">(),
	embed: json("embed").$type<EmbedType>(),
	enabled: boolean("enabled").notNull().default(false),
});

export const autoRole = pgTable("auto_role", {
	id: text("id").primaryKey(),
	guildId: text("guild_id").notNull(),
	roleId: text("role_id").notNull(),
	isBot: boolean("is_bot").notNull().default(false),
	enabled: boolean("enabled").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const autoNick = pgTable("auto_nick", {
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }).primaryKey(),
	nickname: text("nickname").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customRoles = pgTable("custom_roles", {
	guildId: text("guild_id")
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" })
		.notNull(),
	managerRole: text("manager_role"),
	roles: json("roles").$type<Roles[]>(),
});

export const logger = pgTable("logger", {
	guildId: text("guild_id").primaryKey(),
	enabled: boolean("enabled").default(false),
	channelAndType:
		json("channel_and_type").$type<
			{
				channelId: string;
				type: string;
			}[]
		>(),
});

export const tickets = pgTable("tickets", {
	id: text("id").primaryKey(),
	ticketNumber: integer("ticket_number").notNull(),
	channelId: text("channel_id").notNull(),
	userId: text("user_id").notNull(),
	guildId: text("guild_id").notNull(),
	status: text("status").notNull().default("open"),
	topic: text("topic"),
	transcript: jsonb("transcript"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	closedAt: timestamp("closed_at"),
	closedBy: text("closed_by"),
	claimedBy: text("claimed_by"),
	connectionId: text("connection_id").references(() => ticketConfigs.id, {
		onDelete: "cascade",
		onUpdate: "cascade",
	}),
});

export const ticketConfigs = pgTable("ticket_configs", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	openLimit: integer("open_limit").notNull().default(1),
	channelId: text("channel_id"),
	loggerChannelId: text("logger_channel_id"),
	categoryId: text("category_id"),
	messageId: text("message_id"),
	openCategoryId: text("open_category_id"),
	supportRoles: text("support_roles").array().notNull().default([]),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const guildTicketCounters = pgTable("guild_ticket_counters", {
	guildId: text("guild_id").primaryKey(),
	lastTicketNumber: integer("last_ticket_number").notNull().default(0),
});

export const warnings = pgTable("warnings", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	userId: text("user_id").notNull(),
	reason: text("reason").notNull(),
	moderatorId: text("moderator_id").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const mediaChannel = pgTable("media_channel", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const voiceChannelRole = pgTable("voice_channel_role", {
    guildId: text("guild_id").primaryKey(),
    roleId: text("role_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ignoredChannels = pgTable("ignored_channels", {
	id: text("id").primaryKey(),
	guildId: text("guild_id")
		.notNull()
		.references(() => guilds.guildId, { onDelete: "cascade", onUpdate: "cascade" }),
	channelId: text("channel_id").notNull(),
	unignoreRoles: text("unignore_role").array().notNull().default([]),
	unignoreUsers: text("unignore_user").array().notNull().default([]),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const blacklist = pgTable("blacklist", {
	userId: text("user_id").primaryKey(),
	reason: text("reason").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const voiceCreatorsRelations = relations(voiceCreators, ({ many }) => ({
	rooms: many(rooms),
}));

export const roomsRelations = relations(rooms, ({ one }) => ({
	creator: one(voiceCreators, {
		fields: [rooms.voiceChannelId],
		references: [voiceCreators.voiceChannelId],
	}),
	settings: one(voiceSettings, {
		fields: [rooms.ownerId],
		references: [voiceSettings.userId],
	}),
}));

export const settingsRelations = relations(voiceSettings, ({ many }) => ({
	rooms: many(rooms),
}));

export const AfkRelationsSchema = relations(AFK, ({ one }) => ({
	user: one(users, {
		fields: [AFK.userId],
		references: [users.userId],
	}),
	guild: one(guilds, {
		fields: [AFK.guildId],
		references: [guilds.guildId],
	}),
}));

export const AntiNukeRelations = relations(AntiNuke, ({ one }) => ({
	guild: one(guilds, {
		fields: [AntiNuke.guildId],
		references: [guilds.guildId],
	}),
}));

export const AutoModRelations = relations(AutoMod, ({ one }) => ({
	guild: one(guilds, {
		fields: [AutoMod.guildId],
		references: [guilds.guildId],
	}),
}));

export const GuildsRelations = relations(guilds, ({ many }) => ({
	giveaways: many(giveaways),
	customRoles: many(customRoles),
}));

export const TicketConfigsRelations = relations(ticketConfigs, ({ one }) => ({
	guild: one(guilds, {
		fields: [ticketConfigs.guildId],
		references: [guilds.guildId],
	}),
}));

export const TicketsRelations = relations(tickets, ({ one }) => ({
	ticketConfig: one(ticketConfigs, {
		fields: [tickets.connectionId],
		references: [ticketConfigs.id],
	}),
}));
