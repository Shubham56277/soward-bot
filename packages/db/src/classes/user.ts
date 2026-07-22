import { db, schema } from "..";
import { AFKType, blacklistType, ID, PremiumType, UserType, WarningsType } from "../types";
import { and, eq, sql } from "drizzle-orm";
import { cacheAside, invalidateCache } from "../cache";
import { env } from "@repo/env";

const userCacheKey = (userId: string) => `db:user:${userId}`;
const USER_CACHE_TTL_SECONDS = 60;
const premiumCacheKey = (userId: string) => `db:premium:${userId}`;
const PREMIUM_CACHE_TTL_SECONDS = 30;

export class User implements UserType {
	userId: string;
	noPrefix?: boolean | null | undefined;
	noPrefixExpiresAt?: Date | null | undefined;
	level?: number | null | undefined;
	xp?: number | null | undefined;
	relationships?: "single" | "married" | null | undefined;
	createdAt?: Date | undefined;
	updatedAt?: Date | undefined;

	constructor(userId: string, data: Partial<UserType>) {
		this.userId = userId;
		this.noPrefix = data.noPrefix ?? false;
		this.noPrefixExpiresAt = data.noPrefixExpiresAt ? new Date(data.noPrefixExpiresAt) : data.noPrefixExpiresAt;
		this.level = data.level ?? 0;
		this.xp = data.xp;
		this.relationships = data.relationships;
		this.createdAt = data.createdAt ? new Date(data.createdAt) : data.createdAt;
		this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : data.updatedAt;

		// Check if noPrefix has expired
		if (this.noPrefixExpiresAt && new Date() > this.noPrefixExpiresAt) {
			this.noPrefix = false;
			this.noPrefixExpiresAt = null;
		}
	}

	public static async create(userId: string, data?: Partial<UserType>) {
		const user = new User(userId, data!);
		await db.insert(schema.users).values(user).onConflictDoNothing().execute();
		await invalidateCache(userCacheKey(userId));
		return user;
	}

	public static async get(userId: string) {
		const user = await cacheAside(userCacheKey(userId), USER_CACHE_TTL_SECONDS, async () => {
			const result = (await db.select().from(schema.users).where(eq(schema.users.userId, userId)).execute()).at(0);
			if (!result) return User.create(userId, { noPrefix: false });
			return result;
		});

		return new User(userId, user);
	}

	public static async update(userId: string, data: Partial<UserType>) {
		const user = await User.get(userId);
		if (!user) return;

		await db
			.update(schema.users)
			.set({
				...data,
			})
			.where(eq(schema.users.userId, userId))
			.execute();
		await invalidateCache(userCacheKey(userId));
	}

	public static async setNoPrefix(userId: string, durationMs: number, addedBy: string) {
		const expiresAt = new Date(Date.now() + durationMs);
		await User.update(userId, {
			noPrefix: true,
			noPrefixExpiresAt: expiresAt,
		});

		if (env.NO_PREFIX_WEBHOOK_URL) await fetch(env.NO_PREFIX_WEBHOOK_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				embeds: [
					{
						title: "No Prefix",
						description: `<@${userId}> has been given no prefix for <t:${Math.floor(expiresAt.getTime() / 1000)}:R> by <@${addedBy}>`,
						color: 0xffb500,
					},
				],
			}),
		}).catch(() => {});
	}

	public static async getNoPrefix(userId: string) {
		const user = await User.get(userId);
		if (user.noPrefixExpiresAt && new Date() > user.noPrefixExpiresAt) {
			await db.update(schema.users).set({ noPrefix: false, noPrefixExpiresAt: null }).where(eq(schema.users.userId, userId)).execute();
			await invalidateCache(userCacheKey(userId));
			user.noPrefix = false;
			user.noPrefixExpiresAt = null;
			if (env.NO_PREFIX_WEBHOOK_URL) await fetch(env.NO_PREFIX_WEBHOOK_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					embeds: [
						{
							title: "No Prefix",
							description: `<@${userId}> has had their no prefix removed`,
							color: 0xffb500,
						},
					],
				}),
			}).catch(() => {});
			return false;
		}
		return user.noPrefix;
	}
}

export class AFK implements AFKType {
	public userId: string;
	public reason?: string | null | undefined;
	public global?: boolean | null | undefined;
	public guildId?: string | null | undefined;
	public mentionBy?: ID[];
	public createdAt?: Date | undefined;
	public updatedAt?: Date | undefined;
	constructor(userId: string, data: Partial<AFKType>) {
		this.userId = userId;
		this.reason = data.reason;
		this.global = data.global;
		this.guildId = data.guildId;
		this.mentionBy = data.mentionBy ?? [];
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}

	public static async create(userId: string, data: Partial<AFKType>) {
		const user = await User.get(userId);
		if (!user) {
			await User.create(userId, { noPrefix: false });
		}
		const afk = new AFK(userId, data);

		const existing = (await db.select().from(schema.AFK).where(eq(schema.AFK.userId, userId)).execute()).at(0);
		if (existing) {
			await db.delete(schema.AFK).where(eq(schema.AFK.userId, userId)).execute();
		}
		await db.insert(schema.AFK).values(afk).onConflictDoNothing().execute();
		return afk;
	}

	public static async get(userId: string) {
		const user = await User.get(userId);
		if (!user) {
			await User.create(userId, { noPrefix: false });
		}
		const afk = (await db.select().from(schema.AFK).where(eq(schema.AFK.userId, userId)).execute()).at(0);
		return afk;
	}

	public static async delete(userId: string) {
		await db.delete(schema.AFK).where(eq(schema.AFK.userId, userId)).execute();
	}

	public static async update(userId: string, data: Partial<AFKType>) {
		const user = await User.get(userId);
		if (!user) {
			await User.create(userId, { noPrefix: false });
		}
		const afk = await AFK.get(userId);
		const mentionBy = afk?.mentionBy ?? [];

		// Add new mentions (if any)
		mentionBy.push(...(data.mentionBy ?? []));

		// Filter unique by userId
		const seen = new Set<string>();
		const uniqueMentions = mentionBy.filter((entry) => {
			if (!entry?.id) return false;
			if (seen.has(entry.id)) return false;
			seen.add(entry.id);
			return true;
		});
		await db
			.update(schema.AFK)
			.set({
				...data,
				mentionBy: uniqueMentions,
			})
			.where(eq(schema.AFK.userId, userId))
			.execute();
	}
}

export class Warning implements WarningsType {
	id: string;
	guildId: string;
	userId: string;
	reason: string;
	moderatorId: string;
	createdAt: Date;
	updatedAt: Date;

	constructor(data: WarningsType) {
		this.id = data.id;
		this.guildId = data.guildId;
		this.userId = data.userId;
		this.reason = data.reason;
		this.moderatorId = data.moderatorId;
		this.createdAt = data.createdAt ?? new Date();
		this.updatedAt = data.updatedAt ?? new Date();
	}
	public static async getById(warningId: string) {
		const result = await db
			.select()
			.from(schema.warnings)
			.where(eq(schema.warnings.id, warningId))
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new Warning(result);
	}

	public static async getUserWarnings(guildId: string, userId: string) {
		const results = await db
			.select()
			.from(schema.warnings)
			.where(and(eq(schema.warnings.guildId, guildId), eq(schema.warnings.userId, userId)))
			.execute();

		return results.map((result) => new Warning(result));
	}
	public static async getUserWarningCount(guildId: string, userId: string) {
		const result = await db
			.select({ count: sql<number>`count(*)` })
			.from(schema.warnings)
			.where(and(eq(schema.warnings.guildId, guildId), eq(schema.warnings.userId, userId)))
			.execute()
			.then((result) => result.at(0));

		return result?.count ?? 0;
	}

	public static async create(data: Omit<WarningsType, "id" | "createdAt" | "updatedAt">) {
		const { nanoid } = await import("nanoid");
		const result = await db
			.insert(schema.warnings)
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
		return new Warning(result);
	}

	public static async delete(warningId: string) {
		await db.delete(schema.warnings).where(eq(schema.warnings.id, warningId)).execute();
	}

	public static async deleteAllUserWarnings(guildId: string, userId: string) {
		await db
			.delete(schema.warnings)
			.where(and(eq(schema.warnings.guildId, guildId), eq(schema.warnings.userId, userId)))
			.execute();
	}

	public static async update(warningId: string, newReason: string) {
		await db
			.update(schema.warnings)
			.set({
				reason: newReason,
				updatedAt: new Date(),
			})
			.where(eq(schema.warnings.id, warningId))
			.execute();

		return await Warning.getById(warningId);
	}
}

//blacklistType
export class Blacklist implements blacklistType {
	userId: string;
	reason: string;
	createdAt?: Date | undefined;
	updatedAt?: Date | undefined;

	constructor(data: blacklistType) {
		this.userId = data.userId;
		this.reason = data.reason;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}

	public static async get(userId: string) {
		const result = await db
			.select()
			.from(schema.blacklist)
			.where(eq(schema.blacklist.userId, userId))
			.execute()
			.then((result) => result.at(0));

		if (!result) return null;
		return new Blacklist(result);
	}

	public static async create(data: Omit<blacklistType, "createdAt" | "updatedAt">) {
		const result = await db
			.insert(schema.blacklist)
			.values({
				...data,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning()
			.execute()
			.then((result) => result.at(0));
		if (!result) return null;
		return new Blacklist(result);
	}

	public static async delete(userId: string) {
		await db.delete(schema.blacklist).where(eq(schema.blacklist.userId, userId)).execute();
	}

	public static async update(userId: string, newReason: string) {
		await db
			.update(schema.blacklist)
			.set({
				reason: newReason,
				updatedAt: new Date(),
			})
			.where(eq(schema.blacklist.userId, userId))
			.execute();

		return await Blacklist.get(userId);
	}
}

export class Premium implements PremiumType {
	userId: string;
	isPremium: boolean;
	premiumSince?: Date | null;
	premiumUntil?: Date | null;

	createdAt?: Date;
	updatedAt?: Date;

	constructor(userId: string, data: Partial<PremiumType> = {}) {
		this.userId = userId;
		this.isPremium = data.isPremium ?? false;
		this.premiumSince = data.premiumSince ? new Date(data.premiumSince) : data.premiumSince;
		this.premiumUntil = data.premiumUntil ? new Date(data.premiumUntil) : data.premiumUntil;

		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;

		// Check if premium has expired
		this.checkPremiumStatus();
	}

	private checkPremiumStatus() {
		if (this.premiumUntil && new Date() > this.premiumUntil) {
			this.isPremium = false;
			this.premiumSince = null;
			this.premiumUntil = null;
			this.updatedAt = new Date();
		}
	}

	public static async create(userId: string, data?: Partial<PremiumType>) {
		await User.get(userId);
		const premium = new Premium(userId, data);
		await db.insert(schema.premium).values(premium).onConflictDoNothing().execute();
		await invalidateCache(premiumCacheKey(userId));
		return premium;
	}

	public static async get(userId: string) {
		const premiumData = await cacheAside(premiumCacheKey(userId), PREMIUM_CACHE_TTL_SECONDS, () =>
			db.select().from(schema.premium).where(eq(schema.premium.userId, userId)).execute().then((rows) => rows.at(0) ?? null),
		);

		if (!premiumData) {
			return await Premium.create(userId, { isPremium: false });
		}

		if (premiumData.premiumUntil && new Date() > premiumData.premiumUntil) {
			await db
				.update(schema.premium)
				.set({
					isPremium: false,
					premiumSince: null,
					premiumUntil: null,
				})
				.where(eq(schema.premium.userId, userId))
				.execute();
			premiumData.isPremium = false;
			premiumData.premiumSince = null;
			premiumData.premiumUntil = null;
			await invalidateCache(premiumCacheKey(userId));
			if (env.PREMIUM_WEBHOOK_URL) await fetch(env.PREMIUM_WEBHOOK_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					embeds: [
						{
							title: "Premium Expired",
							description: `Premium for ${userId} has expired.`,
							color: 0xff0000,
						},
					],
				}),
			});
			return new Premium(userId, premiumData);
		}

		return new Premium(userId, premiumData);
	}

	public static async update(userId: string, data: Partial<PremiumType>) {
		const premium = await Premium.get(userId);
		if (!premium) return;

		await db
			.update(schema.premium)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(schema.premium.userId, userId))
			.execute();
		await invalidateCache(premiumCacheKey(userId));
	}

	public static async activatePremium(userId: string, durationMs: number) {
		await User.get(userId);
		const now = new Date();
		const premiumUntil = new Date(now.getTime() + durationMs);

		await db
			.insert(schema.premium)
			.values({
				userId,
				isPremium: true,
				premiumSince: now,
				premiumUntil,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: schema.premium.userId,
				set: {
					isPremium: true,
					premiumSince: now,
					premiumUntil,
					updatedAt: now,
				},
			})
			.execute();
		await invalidateCache(premiumCacheKey(userId));

		if (env.PREMIUM_WEBHOOK_URL) await fetch(env.PREMIUM_WEBHOOK_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				embeds: [
					{
						title: "Premium Activated",
						color: 0x00ff00,
						fields: [
							{
								name: "User",
								value: `<@${userId}>`,
								inline: true,
							},
							{
								name: "Duration",
								value: `<t:${Math.floor(premiumUntil.getTime() / 1000)}>`,
								inline: true,
							},
						],
					},
				],
			}),
		});
	}

	public static async revokePremium(userId: string) {
		await db
			.update(schema.premium)
			.set({
				isPremium: false,
				premiumSince: null,
				premiumUntil: null,
				updatedAt: new Date(),
			})
			.where(eq(schema.premium.userId, userId))
			.execute();
		await invalidateCache(premiumCacheKey(userId));
	}

	public static async hasPremium(userId: string): Promise<boolean> {
		const premium = await Premium.get(userId);
		return premium?.isPremium ?? false;
	}
}
