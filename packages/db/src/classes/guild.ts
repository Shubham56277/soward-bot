import { env } from "@repo/env";
import {
	AntiNukeChannel,
	AntiNukeMember,
	AntiNukeType,
	AutoModType,
	AutoNickType,
	AutoresponderType,
	AutoRoleType,
	CustomRoleType,
	EmbedType,
	GiveawaysType,
	GuildType,
	ID,
	LoggerType,
	Roles,
	RoomType,
	TicketConfigType,
	TicketType,
	VoiceCreatorType,
	VoiceSettingsType,
	WelcomeType,
	MediaChannelType,
	VoiceChannelRoleType,
	IgnoredChannelsType,
} from "../types";
import { db, schema } from "..";
import { and, eq } from "drizzle-orm";
import { cacheAside, invalidateCache } from "../cache";

const ignoredChannelCacheKey = (guildId: string, channelId: string) => `db:ignored-channel:${guildId}:${channelId}`;
const IGNORED_CHANNEL_CACHE_TTL_SECONDS = 30;
import { guildTicketCounters } from "../schema";

const guildCacheKey = (guildId: string) => `db:guild:${guildId}`;
const GUILD_CACHE_TTL_SECONDS = 300;
export class Guild implements GuildType {
	public guildId: string;
	public prefix: string;
	public language: string;
	public twoFourSeven?: { channelId: string } | null;
	public customRoles?: ID[];
	public createdAt: Date;
	giveawaysManagerRole?: string | null;
	public updatedAt: Date;
	constructor(guildId: string, data: Partial<GuildType>) {
		this.guildId = guildId;
		this.prefix = data.prefix ?? env.PREFIX;
		this.language = data.language ?? "en";
		this.twoFourSeven = data.twoFourSeven;
		this.customRoles = data.customRoles ?? [];
		this.giveawaysManagerRole = data.giveawaysManagerRole ?? null;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}

	public static async create(guildId: string, data?: Partial<GuildType>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const now = new Date();
		await db
			.insert(schema.guilds)
			.values({
				guildId,
				prefix: data?.prefix ?? env.PREFIX,
				language: data?.language ?? "en",
				twoFourSeven: data?.twoFourSeven ?? null,
				createdAt: data?.createdAt ?? now,
				updatedAt: data?.updatedAt ?? now,
			})
			.onConflictDoNothing()
			.execute();
		await invalidateCache(guildCacheKey(guildId));

		return new Guild(guildId, data!);
	}
	public static async get(guildId: string) {
		return cacheAside(guildCacheKey(guildId), GUILD_CACHE_TTL_SECONDS, async () => {
			const guild = (await db.select().from(schema.guilds).where(eq(schema.guilds.guildId, guildId)).execute()).at(0);
			if (!guild) return Guild.create(guildId, { prefix: env.PREFIX });
			return guild;
		});
	}

	public static async update(guildId: string, data: Partial<GuildType>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const guild = await Guild.get(guildId);
		if (!guild) return;

		await db
			.update(schema.guilds)
			.set({
				...data,
			})
			.where(eq(schema.guilds.guildId, guildId))
			.execute();
		await invalidateCache(guildCacheKey(guildId));
	}

	public static async reset(guildId: string) {
		await db.delete(schema.guilds).where(eq(schema.guilds.guildId, guildId)).execute();
		await invalidateCache(guildCacheKey(guildId));
	}

	public static async getAll() {
		return await db.select().from(schema.guilds).execute();
	}
}
export class AntiNuke implements AntiNukeType {
	public guildId: string;
	public enabled: boolean;
	public trustedUsers: ID[];
	public admin: string | null;
	public channel: AntiNukeChannel[];
	public member: AntiNukeMember[];
	public emoji: AntiNukeChannel[];
	public webhook: AntiNukeChannel[];
	public sticker: AntiNukeChannel[];
	public mention: boolean;
	public guild: AntiNukeChannel[];
	public gateKeeper: boolean;
	public role: AntiNukeChannel[];
	public createdAt: Date;

	constructor(guildId: string, data: Partial<AntiNukeType>) {
		this.guildId = guildId;
		this.trustedUsers = data.trustedUsers ?? [];
		this.admin = data.admin ?? null;
		this.enabled = data.enabled ?? false;
		this.channel = data.channel ?? [];
		this.member = data.member ?? [];
		this.emoji = data.emoji ?? [];
		this.webhook = data.webhook ?? [];
		this.sticker = data.sticker ?? [];
		this.gateKeeper = data.gateKeeper ?? false;
		this.mention = data.mention ?? false;
		this.guild = data.guild ?? [];
		this.role = data.role ?? [];
		this.createdAt = data.createdAt ?? new Date();
	}

	public static async create(guildId: string, data?: Partial<AntiNukeType>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const antiNuke = new AntiNuke(guildId, data!);
		await db.insert(schema.AntiNuke).values(antiNuke).onConflictDoNothing().execute();

		return antiNuke;
	}

	public static async get(guildId: string) {
		// Fall back to database
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const data = (await db.select().from(schema.AntiNuke).where(eq(schema.AntiNuke.guildId, guildId)).execute()).at(0);

		if (!data) {
			const defaultConfig = new AntiNuke(guildId, { enabled: false });
			// Cache the default config
			return defaultConfig;
		}

		// Cache the fetched data
		return new AntiNuke(guildId, data);
	}

	public static async delete(guildId: string): Promise<void> {
		await db.delete(schema.AntiNuke).where(eq(schema.AntiNuke.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<AntiNuke>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		// First ensure the guild exists
		const guild = await Guild.get(guildId);
		if (!guild) {
			await Guild.create(guildId);
		}

		// Check if AntiNuke record exists
		const existingAntiNuke = (await db.select().from(schema.AntiNuke).where(eq(schema.AntiNuke.guildId, guildId)).execute()).at(0);

		if (!existingAntiNuke) {
			return await AntiNuke.create(guildId, data);
		}

		await db
			.update(schema.AntiNuke)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.AntiNuke.guildId, guildId))
			.execute();

		return await AntiNuke.get(guildId);
	}
}

export class AutoMod implements AutoModType {
	guildId: string;
	link?: { enabled: boolean; allowedDomains: string[]; ignoredChannels: ID[]; ignoredRoles: ID[]; ignoredUsers: ID[]; action: "delete" | "warn" | "timeout" | "kick" | "ban" } | null | undefined;
	createdAt?: Date | undefined;
	updatedAt?: Date | undefined;
	spam?: { enabled: boolean; action: "ban" | "timeout" | "kick"; ignoredChannels: ID[]; ignoredRoles: ID[]; ignoredUsers: ID[]; spamLimit: number; maxEmojis: number } | null | undefined;
	enabled?: boolean | undefined;
	constructor(guildId: string, data: Partial<AutoModType>) {
		this.guildId = guildId;
		this.link = data.link ?? { enabled: false, allowedDomains: [], ignoredChannels: [], ignoredRoles: [], ignoredUsers: [], action: "delete" };
		this.spam = data.spam ?? { enabled: false, action: "timeout", ignoredChannels: [], ignoredRoles: [], ignoredUsers: [], spamLimit: 7, maxEmojis: 10 };
		this.enabled = data.enabled ?? false;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}

	public static async create(guildId: string, data?: Partial<AutoModType>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const autoMod = new AutoMod(guildId, data!);
		await db.insert(schema.AutoMod).values(autoMod).onConflictDoNothing().execute();

		return autoMod;
	}

	public static async get(guildId: string) {
		// Fall back to database
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const data = (await db.select().from(schema.AutoMod).where(eq(schema.AutoMod.guildId, guildId)).execute()).at(0);

		if (!data) {
			const defaultConfig = new AutoMod(guildId, {});
			// Cache the default config
			return defaultConfig;
		}

		// Cache the fetched data
		return new AutoMod(guildId, data);
	}

	public static async delete(guildId: string): Promise<void> {
		await db.delete(schema.AutoMod).where(eq(schema.AutoMod.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<AutoMod>) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		// First ensure the guild exists
		const guild = await Guild.get(guildId);
		if (!guild) {
			await Guild.create(guildId);
		}

		// Check if AntiNuke record exists
		const existingAutoMod = (await db.select().from(schema.AutoMod).where(eq(schema.AutoMod.guildId, guildId)).execute()).at(0);

		if (!existingAutoMod) {
			return await AutoMod.create(guildId, data);
		}

		await db
			.update(schema.AutoMod)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.AutoMod.guildId, guildId))
			.execute();

		return await AutoMod.get(guildId);
	}
}

export class VoiceSettings implements VoiceSettingsType {
	guildId: string;
	userId: string;
	name: string;
	userLimit: number;
	locked: boolean;
	visible: boolean;
	leave: number;

	constructor(guildId: string, userId: string, data: Partial<VoiceSettingsType>) {
		this.guildId = guildId;
		this.userId = userId;
		this.name = data.name ?? "0";
		this.userLimit = data.userLimit ?? 10;
		this.locked = data.locked ?? false;
		this.visible = data.visible ?? false;
		this.leave = data.leave ?? 0;
	}

	public static async create(guildId: string, userId: string, data?: Partial<VoiceSettingsType>) {
		if (!guildId || !userId) {
			throw new Error("guildId and userId are required");
		}

		const settings = new VoiceSettings(guildId, userId, data ?? {});
		await db.insert(schema.voiceSettings).values(settings).onConflictDoNothing().execute();

		return settings;
	}

	public static async get(guildId: string, userId: string) {
		if (!guildId || !userId) {
			throw new Error("guildId and userId are required");
		}

		const data = (
			await db
				.select()
				.from(schema.voiceSettings)
				.where(and(eq(schema.voiceSettings.guildId, guildId), eq(schema.voiceSettings.userId, userId)))
				.execute()
		).at(0);

		if (!data) {
			const defaultSettings = new VoiceSettings(guildId, userId, {});
			await VoiceSettings.create(guildId, userId, defaultSettings);
			return defaultSettings;
		}

		return new VoiceSettings(guildId, userId, data);
	}

	public static async delete(guildId: string, userId: string): Promise<void> {
		await db
			.delete(schema.voiceSettings)
			.where(and(eq(schema.voiceSettings.guildId, guildId), eq(schema.voiceSettings.userId, userId)))
			.execute();
	}

	public static async update(guildId: string, userId: string, data: Partial<VoiceSettingsType>) {
		if (!guildId || !userId) {
			throw new Error("guildId and userId are required");
		}

		const existingSettings = await VoiceSettings.get(guildId, userId);
		if (!existingSettings) {
			return await VoiceSettings.create(guildId, userId, data);
		}

		await db
			.update(schema.voiceSettings)
			.set(data)
			.where(and(eq(schema.voiceSettings.guildId, guildId), eq(schema.voiceSettings.userId, userId)))
			.execute();

		return await VoiceSettings.get(guildId, userId);
	}
}

export class VoiceCreator implements VoiceCreatorType {
	guildId: string;
	textChannelId: string;
	voiceChannelId: string;
	categoryId: string;

	constructor(guildId: string, data: Omit<VoiceCreatorType, "guildId">) {
		this.guildId = guildId;
		this.textChannelId = data.textChannelId;
		this.voiceChannelId = data.voiceChannelId;
		this.categoryId = data.categoryId;
	}

	public static async create(guildId: string, data: Omit<VoiceCreatorType, "guildId">) {
		if (!guildId) {
			throw new Error("guildId is required");
		}

		const creator = new VoiceCreator(guildId, {
			textChannelId: data.textChannelId,
			voiceChannelId: data.voiceChannelId,
			categoryId: data.categoryId,
		});

		await db.insert(schema.voiceCreators).values(creator).onConflictDoNothing().execute();

		return creator;
	}

	public static async get(guildId: string, categoryId: string) {
		if (!guildId || !categoryId) {
			throw new Error("guildId and categoryId are required");
		}

		const data = (
			await db
				.select()
				.from(schema.voiceCreators)
				.where(and(eq(schema.voiceCreators.guildId, guildId), eq(schema.voiceCreators.categoryId, categoryId)))
				.execute()
		).at(0);

		if (!data) return null;

		return new VoiceCreator(guildId, data);
	}
	public static async getByGuildId(guildId: string) {
		if (!guildId) {
			throw new Error("guildId is required");
		}
		const data = (await db.select().from(schema.voiceCreators).where(eq(schema.voiceCreators.guildId, guildId)).execute()).at(0);
		if (!data) return null;
		return data;
	}
	public static async getByVoiceChannelId(guildId: string, voiceChannelId: string) {
		if (!guildId || !voiceChannelId) {
			throw new Error("guildId and voiceChannelId are required");
		}

		const data = (
			await db
				.select()
				.from(schema.voiceCreators)
				.where(and(eq(schema.voiceCreators.guildId, guildId), eq(schema.voiceCreators.voiceChannelId, voiceChannelId)))
				.execute()
		).at(0);

		if (!data) return null;

		return new VoiceCreator(guildId, data);
	}
	public static async delete(guildId: string, categoryId: string): Promise<void> {
		const creator = await VoiceCreator.get(guildId, categoryId);
		if (!creator) return;

		await db
			.delete(schema.voiceCreators)
			.where(and(eq(schema.voiceCreators.guildId, guildId), eq(schema.voiceCreators.categoryId, categoryId)))
			.execute();
	}

	public static async update(guildId: string, categoryId: string, data: Partial<Omit<VoiceCreatorType, "guildId">>) {
		if (!guildId || !categoryId) {
			throw new Error("guildId and categoryId are required");
		}

		const existingCreator = await VoiceCreator.get(guildId, categoryId);
		if (!existingCreator) {
			return await VoiceCreator.create(guildId, {
				textChannelId: data.textChannelId!,
				voiceChannelId: data.voiceChannelId!,
				categoryId: data.categoryId!,
			});
		}

		await db
			.update(schema.voiceCreators)
			.set(data)
			.where(and(eq(schema.voiceCreators.guildId, guildId), eq(schema.voiceCreators.categoryId, categoryId)))
			.execute();

		return await VoiceCreator.get(guildId, categoryId);
	}
}

export class Room implements RoomType {
	id: string;
	voiceChannelId: string;
	ownerId: string;
	cooldown: number;

	constructor(data: RoomType) {
		this.id = data.id;
		this.voiceChannelId = data.voiceChannelId;
		this.ownerId = data.ownerId;
		this.cooldown = data.cooldown;
	}

	public static async create(data: Omit<RoomType, "id">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.rooms)
			.values({
				voiceChannelId: data.voiceChannelId,
				ownerId: data.ownerId,
				cooldown: data.cooldown,
				id: nanoid(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Room(result);
	}

	public static async get(voiceChannelId: string) {
		const data = (await db.select().from(schema.rooms).where(eq(schema.rooms.voiceChannelId, voiceChannelId)).execute()).at(0);

		if (!data) return null;

		return new Room(data);
	}

	public static async delete(voiceChannelId: string): Promise<void> {
		await db.delete(schema.rooms).where(eq(schema.rooms.voiceChannelId, voiceChannelId)).execute();
	}
	public static async deleteById(id: string): Promise<void> {
		await db.delete(schema.rooms).where(eq(schema.rooms.id, id)).execute();
	}
	public static async update(voiceChannelId: string, data: Partial<Omit<RoomType, "id" | "voiceChannelId">>) {
		const existingRoom = await Room.get(voiceChannelId);
		if (!existingRoom) {
			throw new Error("Room not found");
		}
		await db.update(schema.rooms).set(data).where(eq(schema.rooms.voiceChannelId, voiceChannelId)).execute();

		return await Room.get(voiceChannelId);
	}
}

export class Giveaway implements GiveawaysType {
	id: string;
	guildId: string;
	channelId: string;
	hostedBy: string;
	messageId: string;
	prize: string;
	winners: number;
	duration: number;
	endAt: Date;
	paused: boolean | undefined;
	ended?: boolean | undefined;
	participants?: ID[] | null | undefined;
	createdAt?: Date | undefined;
	updatedAt?: Date | undefined;
	constructor(guildId: string, data: GiveawaysType) {
		this.guildId = guildId;
		this.id = data.id;
		this.channelId = data.channelId;
		this.hostedBy = data.hostedBy;
		this.messageId = data.messageId;
		this.prize = data.prize;
		this.winners = data.winners;
		this.duration = data.duration;
		this.paused = data.paused;
		this.ended = data.ended;
		this.participants = data.participants;
		this.endAt = data.endAt;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}
	public static async create(data: Omit<GiveawaysType, "id">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.giveaways)
			.values({
				id: nanoid(),
				guildId: data.guildId,
				channelId: data.channelId,
				hostedBy: data.hostedBy,
				messageId: data.messageId,
				prize: data.prize,
				winners: data.winners,
				paused: data.paused,
				duration: data.duration,
				ended: data.ended,
				participants: data.participants,
				endAt: data.endAt,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Giveaway(result.guildId, result);
	}

	public static async get(guildId: string, messageId: string) {
		const data = (
			await db
				.select()
				.from(schema.giveaways)
				.where(and(eq(schema.giveaways.guildId, guildId), eq(schema.giveaways.messageId, messageId)))
				.execute()
		).at(0);

		if (!data) return null;

		return new Giveaway(guildId, data);
	}

	public static async getAll(guildId: string) {
		const data = await db.select().from(schema.giveaways).where(eq(schema.giveaways.guildId, guildId)).execute();
		if (!data) return null;
		return data.map((giveaway) => new Giveaway(giveaway.guildId, giveaway));
	}
	public static async delete(guildId: string, messageId: string): Promise<void> {
		await db
			.delete(schema.giveaways)
			.where(and(eq(schema.giveaways.guildId, guildId), eq(schema.giveaways.messageId, messageId)))
			.execute();
	}
	public static async deleteById(id: string): Promise<void> {
		await db.delete(schema.giveaways).where(eq(schema.giveaways.id, id)).execute();
	}
	public static async update(guildId: string, messageId: string, data: Partial<Omit<GiveawaysType, "id" | "guildId" | "messageId">>) {
		const existingGiveaway = await Giveaway.get(guildId, messageId);
		if (!existingGiveaway) {
			throw new Error("Giveaway not found");
		}
		await db
			.update(schema.giveaways)
			.set(data)
			.where(and(eq(schema.giveaways.guildId, guildId), eq(schema.giveaways.messageId, messageId)))
			.execute();

		return await Giveaway.get(guildId, messageId);
	}

	public static async updateParticipants(guildId: string, messageId: string, userId: string) {
		const existingGiveaway = await Giveaway.get(guildId, messageId);
		if (!existingGiveaway) {
			throw new Error("Giveaway not found");
		}

		existingGiveaway.participants ??= [];

		if (existingGiveaway.participants.some((p) => p.id === userId)) {
			return false;
		}

		existingGiveaway.participants.push({ id: userId });

		await db
			.update(schema.giveaways)
			.set({ participants: existingGiveaway.participants })
			.where(and(eq(schema.giveaways.guildId, guildId), eq(schema.giveaways.messageId, messageId)))
			.execute();

		return await Giveaway.get(guildId, messageId);
	}
	public static async getAllUnended() {
		const data = await db.select().from(schema.giveaways).where(eq(schema.giveaways.ended, false)).execute();
		if (!data) return null;
		return data.map((giveaway) => new Giveaway(giveaway.guildId, giveaway));
	}
}

export class AutoResponder implements AutoresponderType {
	id: string;
	guildId: string;
	trigger: string;
	response: string;
	name: string;
	useRegex?: boolean | null | undefined;
	reactionEmoji?: string | null | undefined;
	cooldown?: number | null | undefined;
	createdAt?: Date | null | undefined;
	channelId?: string | null | undefined;
	enabled?: boolean | null | undefined;

	constructor(data: AutoresponderType) {
		this.id = data.id;
		this.guildId = data.guildId;
		this.name = data.name;
		this.trigger = data.trigger;
		this.response = data.response;
		this.reactionEmoji = data.reactionEmoji;
		this.useRegex = data.useRegex;
		this.cooldown = data.cooldown;
		this.createdAt = data.createdAt;
		this.channelId = data.channelId;
		this.enabled = data.enabled;
	}

	public static async get(guildId: string, name: string) {
		const result = await db
			.select()
			.from(schema.autoResponder)
			.where(and(eq(schema.autoResponder.guildId, guildId), eq(schema.autoResponder.name, name)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new AutoResponder(result);
	}

	public static async create(data: Omit<AutoresponderType, "id">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.autoResponder)
			.values({
				...data,
				id: nanoid(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new AutoResponder(result);
	}

	public static async getAll(guildId: string) {
		const data = await db.select().from(schema.autoResponder).where(eq(schema.autoResponder.guildId, guildId)).execute();
		if (!data) return null;
		return data.map((autoresponder) => new AutoResponder(autoresponder));
	}

	public static async delete(guildId: string, name: string) {
		await db
			.delete(schema.autoResponder)
			.where(and(eq(schema.autoResponder.guildId, guildId), eq(schema.autoResponder.name, name)))
			.execute();
	}

	public static async deleteById(id: string): Promise<void> {
		await db.delete(schema.autoResponder).where(eq(schema.autoResponder.id, id)).execute();
	}

	public static async update(guildId: string, name: string, data: Partial<Omit<AutoresponderType, "id" | "guildId" | "name">>) {
		await db
			.update(schema.autoResponder)
			.set(data)
			.where(and(eq(schema.autoResponder.guildId, guildId), eq(schema.autoResponder.name, name)))
			.execute();
		return await AutoResponder.get(guildId, name);
	}
}

export class CustomRole implements CustomRoleType {
	guildId: string;
	managerRole: string | null;
	roles: Roles[] | null;

	constructor(data: CustomRoleType) {
		this.guildId = data.guildId;
		this.managerRole = data.managerRole ?? null;
		this.roles = data.roles ?? null;
	}

	public static async get(guildId: string) {
		const result = await db
			.select()
			.from(schema.customRoles)
			.where(eq(schema.customRoles.guildId, guildId))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new CustomRole(result);
	}
	public static async create(data: Omit<CustomRoleType, "id">) {
		const result = await db
			.insert(schema.customRoles)
			.values(data)
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new CustomRole(result);
	}

	public static async delete(guildId: string) {
		await db.delete(schema.customRoles).where(eq(schema.customRoles.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<Omit<CustomRoleType, "id" | "guildId">>) {
		const existingCustomRole = await CustomRole.get(guildId);
		if (!existingCustomRole) {
			return await CustomRole.create({ guildId, ...data });
		}
		await db.update(schema.customRoles).set(data).where(eq(schema.customRoles.guildId, guildId)).execute();
		return await CustomRole.get(guildId);
	}
}

export class Welcome implements WelcomeType {
	guildId: string;
	channelId: string;
	message: string;
	enabled: boolean | undefined;
	type: "embed" | "text" | "card" | "embed-text";
	embed: EmbedType | null;
	constructor(data: WelcomeType) {
		this.guildId = data.guildId;
		this.channelId = data.channelId;
		this.message = data.message;
		this.enabled = data.enabled ?? false;
		this.type = data.type;
		this.embed = data.embed ?? null;
	}

	public static async get(guildId: string) {
		const result = await db
			.select()
			.from(schema.welcome)
			.where(eq(schema.welcome.guildId, guildId))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Welcome(result);
	}

	public static async create(data: WelcomeType) {
		const result = await db
			.insert(schema.welcome)
			.values(data)
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Welcome(result);
	}

	public static async delete(guildId: string) {
		await db.delete(schema.welcome).where(eq(schema.welcome.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<Omit<WelcomeType, "guildId">>) {
		const existingWelcome = await Welcome.get(guildId);
		if (!existingWelcome) {
			return await Welcome.create({ guildId, channelId: data.channelId ?? "", message: data.message ?? "", enabled: data.enabled, type: data.type ?? "card" });
		}
		await db.update(schema.welcome).set(data).where(eq(schema.welcome.guildId, guildId)).execute();
		return await Welcome.get(guildId);
	}
}

export class AutoRole implements AutoRoleType {
	id: string;
	guildId: string;
	roleId: string;
	isBot: boolean;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;

	constructor(data: AutoRoleType) {
		this.id = data.id;
		this.guildId = data.guildId;
		this.roleId = data.roleId;
		this.isBot = data.isBot ?? false;
		this.enabled = data.enabled ?? false;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}

	public static async getForGuild(guildId: string) {
		const results = await db.select().from(schema.autoRole).where(eq(schema.autoRole.guildId, guildId)).execute();

		return results.map((result) => new AutoRole(result));
	}

	public static async getById(id: string) {
		const result = await db
			.select()
			.from(schema.autoRole)
			.where(eq(schema.autoRole.id, id))
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new AutoRole(result);
	}

	public static async create(data: Omit<AutoRoleType, "id" | "createdAt" | "updatedAt">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.autoRole)
			.values({
				...data,
				id: nanoid(),
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new AutoRole(result);
	}

	public static async delete(id: string) {
		await db.delete(schema.autoRole).where(eq(schema.autoRole.id, id)).execute();
	}

	public static async update(id: string, data: Partial<Omit<AutoRoleType, "id" | "guildId" | "createdAt">>) {
		await db
			.update(schema.autoRole)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.autoRole.id, id))
			.execute();

		return await AutoRole.getById(id);
	}

	public static async deleteAllForGuild(guildId: string) {
		await db.delete(schema.autoRole).where(eq(schema.autoRole.guildId, guildId)).execute();
	}
}

export class AutoNick implements AutoNickType {
	guildId: string;
	nickname: string;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;

	constructor(data: AutoNickType) {
		this.guildId = data.guildId;
		this.nickname = data.nickname;
		this.enabled = data.enabled ?? false;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}

	public static async get(guildId: string) {
		const result = await db
			.select()
			.from(schema.autoNick)
			.where(eq(schema.autoNick.guildId, guildId))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new AutoNick(result);
	}

	public static async create(data: Omit<AutoNickType, "createdAt" | "updatedAt">) {
		const result = await db
			.insert(schema.autoNick)
			.values({
				...data,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new AutoNick(result);
	}

	public static async delete(guildId: string) {
		await db.delete(schema.autoNick).where(eq(schema.autoNick.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<Omit<AutoNickType, "guildId" | "createdAt" | "updatedAt">>) {
		const existingAutoNick = await AutoNick.get(guildId);

		if (!existingAutoNick) {
			return await AutoNick.create({ guildId, nickname: data.nickname ?? "", enabled: data.enabled });
		}
		await db
			.update(schema.autoNick)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.autoNick.guildId, guildId))
			.execute();

		return await AutoNick.get(guildId);
	}

	public static async deleteAllForGuild(guildId: string) {
		await db.delete(schema.autoNick).where(eq(schema.autoNick.guildId, guildId)).execute();
	}
}
export class AuditLogger implements LoggerType {
	guildId: string;
	enabled: boolean;
	channelAndType: {
		channelId: string;
		type: string;
	}[];

	constructor(data: LoggerType) {
		this.guildId = data.guildId;
		this.enabled = data.enabled ?? false;
		this.channelAndType = data.channelAndType ?? [];
	}

	public static async get(guildId: string) {
		const result = await db
			.select()
			.from(schema.logger)
			.where(eq(schema.logger.guildId, guildId))
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new AuditLogger(result);
	}

	public static async create(data: LoggerType) {
		const result = await db
			.insert(schema.logger)
			.values(data)
			.returning()
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new AuditLogger(result);
	}

	public static async delete(guildId: string) {
		await db.delete(schema.logger).where(eq(schema.logger.guildId, guildId)).execute();
	}

	public static async update(guildId: string, data: Partial<Omit<LoggerType, "guildId">>) {
		const existingLogger = await AuditLogger.get(guildId);
		if (!existingLogger) {
			return await AuditLogger.create({
				guildId,
				enabled: data.enabled ?? false,
				channelAndType: data.channelAndType ?? [],
			});
		}

		await db.update(schema.logger).set(data).where(eq(schema.logger.guildId, guildId)).execute();

		return await AuditLogger.get(guildId);
	}

	public static async updateChannelAndType(guildId: string, channelId: string, type: string): Promise<AuditLogger | null> {
		const existingLogger = await AuditLogger.get(guildId);
		const newEntry = { channelId, type };

		// If no existing config, create one
		if (!existingLogger) {
			return await AuditLogger.create({
				guildId,
				enabled: true,
				channelAndType: [newEntry],
			});
		}

		// Check if this exact mapping already exists
		const exists = existingLogger.channelAndType.some((entry) => entry.channelId === channelId && entry.type === type);

		if (exists) {
			return existingLogger;
		}
		const typeExistsInOtherChannel = existingLogger.channelAndType.some((entry) => entry.type === type && entry.channelId !== channelId);

		if (typeExistsInOtherChannel) {
			// remove from the other channel
			const updatedMappings = existingLogger.channelAndType.filter((entry) => !(entry.type === type && entry.channelId !== channelId));
			await AuditLogger.update(guildId, {
				channelAndType: updatedMappings,
			});
		}
		// Add the new mapping
		return await AuditLogger.update(guildId, {
			channelAndType: [...existingLogger.channelAndType, newEntry],
		});
	}
	public static async addChannelAndType(guildId: string, channelId: string, type: string): Promise<AuditLogger | null> {
		return await AuditLogger.updateChannelAndType(guildId, channelId, type);
	}
	public static async removeChannelAndType(guildId: string, channelId: string, type: string): Promise<AuditLogger | null> {
		const existingLogger = await AuditLogger.get(guildId);
		if (!existingLogger) return null;

		const updatedMappings = existingLogger.channelAndType.filter((entry) => !(entry.channelId === channelId && entry.type === type));

		// If nothing was removed, return the existing logger
		if (updatedMappings.length === existingLogger.channelAndType.length) {
			return existingLogger;
		}

		return await AuditLogger.update(guildId, {
			channelAndType: updatedMappings,
		});
	}

	public static async getChannelsByType(guildId: string, type: string): Promise<string[]> {
		const logger = await AuditLogger.get(guildId);
		if (!logger) return [];

		return logger.channelAndType.filter((entry) => entry.type === type).map((entry) => entry.channelId);
	}

	public static async getChannelForType(guildId: string, type: string): Promise<string | null> {
		const logger = await AuditLogger.get(guildId);
		if (!logger) return null;

		const entry = logger.channelAndType.find((entry) => entry.type === type);
		return entry?.channelId ?? null;
	}
}

export class Ticket implements TicketType {
	public id: string;
	public channelId: string;
	public ticketNumber: number;
	public userId: string;
	public guildId: string;
	public status: string;
	public topic?: string;
	public transcript: any | null;
	public createdAt: Date;
	public closedAt?: Date;
	public closedBy?: string;
	public messages?: any;
	public claimedBy?: string;
	public connectionId: string | null;
	public constructor(data: TicketType) {
		this.id = data.id ?? "";
		this.channelId = data.channelId;
		this.ticketNumber = data.ticketNumber ?? 0;
		this.userId = data.userId;
		this.guildId = data.guildId;
		this.status = data.status ?? "open";
		this.topic = data.topic ?? undefined;

		this.transcript = data.transcript ?? undefined;
		this.createdAt = data.createdAt ?? new Date();
		this.closedAt = data.closedAt ?? undefined;
		this.closedBy = data.closedBy ?? undefined;

		this.claimedBy = data.claimedBy ?? undefined;
		this.connectionId = data.connectionId ?? null;
	}

	public static async getTicketById(id: string) {
		const result = await db
			.select()
			.from(schema.tickets)
			.where(eq(schema.tickets.id, id))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async create(data: Omit<TicketType, "id" | "createdAt">) {
		const { nanoid } = await import("nanoid");
		const id = nanoid();

		const result = await db
			.insert(schema.tickets)
			.values({
				...data,
				id: id,
				createdAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async getNextTicketNumber(guildId: string): Promise<number> {
		// This uses a transaction to ensure atomicity
		return db.transaction(async (tx) => {
			// Try to get the current counter
			const [counter] = await tx.select().from(guildTicketCounters).where(eq(guildTicketCounters.guildId, guildId));

			if (counter) {
				// If exists, increment and return
				const [updated] = await tx
					.update(guildTicketCounters)
					.set({ lastTicketNumber: counter.lastTicketNumber + 1 })
					.where(eq(guildTicketCounters.guildId, guildId))
					.returning();
				return updated?.lastTicketNumber ?? 0;
			}
			// If not exists, create with 0 and return 0
			const [newCounter] = await tx.insert(guildTicketCounters).values({ guildId, lastTicketNumber: 1 }).returning();
			return newCounter?.lastTicketNumber ?? 0;
		});
	}
	public static async getOpenTicketByUser(guildId: string, userId: string) {
		const result = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.userId, userId), eq(schema.tickets.status, "open")))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}

	public static async getTicketByChannelId(guildId: string, channelId: string) {
		const result = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.channelId, channelId)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async closeTicket(id: string, closedBy: string) {
		const result = await db
			.update(schema.tickets)
			.set({ status: "closed", closedAt: new Date(), closedBy: closedBy })
			.where(eq(schema.tickets.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async getOpenTickets(guildId: string) {
		const result = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, "open")))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async getClosedTickets(guildId: string) {
		const result = await db
			.select()
			.from(schema.tickets)
			.where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, "closed")))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async updateClaimedBy(id: string, claimedBy: string | null) {
		const result = await db
			.update(schema.tickets)
			.set({ claimedBy: claimedBy })
			.where(eq(schema.tickets.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}

	public static async update(data: Partial<Omit<TicketType, "createdAt">>) {
		const result = await db
			.update(schema.tickets)
			.set({
				...data,
			})
			.where(eq(schema.tickets.id, data.id!))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async delete(id: string) {
		const result = await db
			.delete(schema.tickets)
			.where(eq(schema.tickets.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Ticket(result);
	}
	public static async getUserTickets(userId: string) {
		const result = await db.select().from(schema.tickets).where(eq(schema.tickets.userId, userId));
		if (!result) return null;
		return result.map((r) => new Ticket(r));
	}
	public static async getAllClosedTickets() {
		const result = await db.select().from(schema.tickets).where(eq(schema.tickets.status, "closed"));
		if (!result) return null;
		return result.map((r) => new Ticket(r));
	}
}

export class TicketConfig implements TicketConfigType {
	public id: string;
	public guildId: string;
	public channelId: string | null;
	public categoryId: string | null;
	public supportRoles: string[];
	public embedConfig: any;
	public createdAt: Date;
	public updatedAt: Date;
	public openCategoryId: string | null;
	public messageId: string | null;
	public loggerChannelId: string | null;
	public openLimit: number;

	public constructor(data: TicketConfigType) {
		this.id = data.id ?? "";
		this.guildId = data.guildId;
		this.channelId = data.channelId ?? null;
		this.categoryId = data.categoryId ?? null;
		this.supportRoles = data.supportRoles ?? [];
		this.openCategoryId = data.openCategoryId ?? null;
		this.messageId = data.messageId ?? null;
		this.loggerChannelId = data.loggerChannelId ?? null;
		this.openLimit = data.openLimit ?? 1;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}

	public static async get(id: string) {
		const result = await db
			.select()
			.from(schema.ticketConfigs)
			.where(eq(schema.ticketConfigs.id, id))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}

	public static async getAllByGuildId(guildId: string) {
		const result = await db.select().from(schema.ticketConfigs).where(eq(schema.ticketConfigs.guildId, guildId)).execute();
		return result.map((r) => new TicketConfig(r));
	}

	public static async getByChannelId(guildId: string, channelId: string) {
		const result = await db
			.select()
			.from(schema.ticketConfigs)
			.where(and(eq(schema.ticketConfigs.guildId, guildId), eq(schema.ticketConfigs.channelId, channelId)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}
	public static async getByCategoryId(guildId: string, categoryId: string) {
		const result = await db
			.select()
			.from(schema.ticketConfigs)
			.where(and(eq(schema.ticketConfigs.guildId, guildId), eq(schema.ticketConfigs.categoryId, categoryId)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}
	public static async getByOpenCategoryId(guildId: string, openCategoryId: string) {
		const result = await db
			.select()
			.from(schema.ticketConfigs)
			.where(and(eq(schema.ticketConfigs.guildId, guildId), eq(schema.ticketConfigs.openCategoryId, openCategoryId)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}
	public static async create(data: Omit<TicketConfigType, "createdAt" | "updatedAt" | "id">) {
		const result = await db
			.insert(schema.ticketConfigs)
			.values({
				id: crypto.randomUUID(),
				...data,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}

	public static async update(id: string, data: Partial<Omit<TicketConfigType, "updatedAt" | "id">>) {
		const result = await db
			.update(schema.ticketConfigs)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.ticketConfigs.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;

		return new TicketConfig(result);
	}

	public static async delete(id: string) {
		const result = await db
			.delete(schema.ticketConfigs)
			.where(eq(schema.ticketConfigs.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new TicketConfig(result);
	}
}


export class MediaChannel implements MediaChannelType {
	public id: string;
	public guildId: string;
	public channelId: string;
	public createdAt: Date;
	public updatedAt: Date;

	public constructor(data: MediaChannelType) {
		this.id = data.id ?? "";
		this.guildId = data.guildId;
		this.channelId = data.channelId;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}
	
	public static async get(id: string) {
		const result = await db
			.select()
			.from(schema.mediaChannel)
			.where(eq(schema.mediaChannel.id, id))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new MediaChannel(result);
	}

	public static async getAllByGuildId(guildId: string) {
		const result = await db.select().from(schema.mediaChannel).where(eq(schema.mediaChannel.guildId, guildId)).execute();
		return result.map((r) => new MediaChannel(r));
	}

	public static async getByGuildIdAndChannelId(guildId: string, channelId: string) {
		const result = await db
			.select()
			.from(schema.mediaChannel)
			.where(and(eq(schema.mediaChannel.guildId, guildId), eq(schema.mediaChannel.channelId, channelId)))
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new MediaChannel(result);
	}

	public static async create(data: Omit<MediaChannelType, "createdAt" | "updatedAt" | "id">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.mediaChannel)
			.values({
				id: nanoid(),
				...data,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new MediaChannel(result);
	}

	public static async update(id: string, data: Partial<Omit<MediaChannelType, "updatedAt" | "id">>) {
		const result = await db
			.update(schema.mediaChannel)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.mediaChannel.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;

		return new MediaChannel(result);
	}

	public static async delete(id: string) {
		const result = await db
			.delete(schema.mediaChannel)
			.where(eq(schema.mediaChannel.id, id))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new MediaChannel(result);
	}
}

export class VoiceChannelRole implements VoiceChannelRoleType {
    public guildId: string;
    public roleId: string;
    public createdAt: Date;
    public updatedAt: Date;

    public constructor(data: VoiceChannelRoleType) {
        this.guildId = data.guildId;
        this.roleId = data.roleId;
        this.createdAt = data.createdAt ?? new Date();
        this.updatedAt = data.updatedAt ?? new Date();
    }
    
    public static async get(guildId: string) {
        const result = await db
            .select()
            .from(schema.voiceChannelRole)
            .where(eq(schema.voiceChannelRole.guildId, guildId))
            .execute()
            .then((result) => result.at(0));
        if (!result) return null;
        return new VoiceChannelRole(result);
    }


    public static async create(data: Omit<VoiceChannelRoleType, "createdAt" | "updatedAt">) {
        const { nanoid } = await import("nanoid");
        const result = await db
            .insert(schema.voiceChannelRole)
            .values({
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning()
            .execute()
            .then((result) => result.at(0));
        if (!result) return null;
        return new VoiceChannelRole(result);
    }

    public static async update(guildId: string, data: Partial<Omit<VoiceChannelRoleType, "updatedAt">>) {
        const result = await VoiceChannelRole.get(guildId);
		if (!result) return await VoiceChannelRole.create({
			...data,
			guildId,
			roleId: data.roleId!
		});
		const result2 = await db
			.update(schema.voiceChannelRole)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.voiceChannelRole.guildId, guildId))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result2) return null;
		return new VoiceChannelRole(result2);
    }

    public static async delete(id: string) {
        const result = await db
            .delete(schema.voiceChannelRole)
            .where(eq(schema.voiceChannelRole.guildId, id))
            .returning()
            .execute()
            .then((result) => result.at(0));
        if (!result) return null;
        return new VoiceChannelRole(result);
    }
}

//IgnoredChannelsType
export class IgnoredChannel implements IgnoredChannelsType {
	guildId: string;
	id: string;
	channelId: string;
	createdAt?: Date | undefined;
	updatedAt?: Date | undefined;
	unignoreRoles?: string[] | undefined;
	unignoreUsers?: string[] | undefined;
	
	constructor(data: IgnoredChannelsType) {
		this.guildId = data.guildId;
		this.id = data.id;
		this.channelId = data.channelId;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
		this.unignoreRoles = data.unignoreRoles;
		this.unignoreUsers = data.unignoreUsers;
	}

	public static async get(guildId: string, channelId: string) {
		const result = await cacheAside(ignoredChannelCacheKey(guildId, channelId), IGNORED_CHANNEL_CACHE_TTL_SECONDS, () => db
			.select()
			.from(schema.ignoredChannels)
			.where(and(eq(schema.ignoredChannels.guildId, guildId), eq(schema.ignoredChannels.channelId, channelId)))
			.execute()
			.then((rows) => rows.at(0) ?? null));
		if (!result) return null;
		return new IgnoredChannel(result);
	}

	public static async create(data: Omit<IgnoredChannelsType, "id" | "createdAt" | "updatedAt">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.ignoredChannels)
			.values({
				...data,
				id: nanoid(),
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		await invalidateCache(ignoredChannelCacheKey(data.guildId, data.channelId));
		return new IgnoredChannel(result);
	}

	public static async delete(guildId: string, channelId: string) {
		const result = await db
			.delete(schema.ignoredChannels)
			.where(and(eq(schema.ignoredChannels.guildId, guildId), eq(schema.ignoredChannels.channelId, channelId)))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		await invalidateCache(ignoredChannelCacheKey(guildId, channelId));
		return new IgnoredChannel(result);
	}

	public static async update(guildId: string, channelId: string, data: Partial<IgnoredChannelsType>) {
		await invalidateCache(ignoredChannelCacheKey(guildId, channelId));
		const result = await IgnoredChannel.get(guildId, channelId);
		if (!result) return await IgnoredChannel.create({
			...data,
			guildId,
			channelId
		});
		const result2 = await db
			.update(schema.ignoredChannels)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(and(eq(schema.ignoredChannels.guildId, guildId), eq(schema.ignoredChannels.channelId, channelId)))
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result2) return null;
		await invalidateCache(ignoredChannelCacheKey(guildId, channelId));
		return new IgnoredChannel(result2);
	}
}
