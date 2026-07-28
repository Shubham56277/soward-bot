import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "..";
import { Guild } from "./guild";
import { User } from "./user";

export interface UserProfileData {
	userId: string;
	bio: string | null;
	badges: string[];
	createdAt: Date;
	updatedAt: Date;
}

export class UserProfile {
	public static async get(userId: string): Promise<UserProfileData> {
		await User.get(userId);
		const row = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId)).limit(1);
		if (row[0]) return row[0];
		const created = await db.insert(schema.userProfiles).values({ userId }).onConflictDoNothing().returning();
		return created[0] ?? { userId, bio: null, badges: [], createdAt: new Date(), updatedAt: new Date() };
	}

	public static async update(userId: string, data: { bio?: string | null; badges?: string[] }): Promise<UserProfileData> {
		await UserProfile.get(userId);
		const rows = await db
			.update(schema.userProfiles)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(schema.userProfiles.userId, userId))
			.returning();
		if (!rows[0]) throw new Error("User profile update did not return a row");
		return rows[0];
	}
}

export interface GuildBotSettingsData {
	guildId: string;
	avatarUrl: string | null;
	bio: string | null;
	bannerUrl: string | null;
	baselineAvatarUrl: string | null;
	baselineBio: string | null;
	baselineBannerUrl: string | null;
	baselineCapturedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

const emptySettings = (guildId: string): GuildBotSettingsData => ({
	guildId,
	avatarUrl: null,
	bio: null,
	bannerUrl: null,
	baselineAvatarUrl: null,
	baselineBio: null,
	baselineBannerUrl: null,
	baselineCapturedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
});

export class GuildBotSettings {
	public static async get(guildId: string): Promise<GuildBotSettingsData> {
		await Guild.get(guildId);
		const row = await db.select().from(schema.guildBotSettings).where(eq(schema.guildBotSettings.guildId, guildId)).limit(1);
		if (row[0]) return row[0];
		const created = await db.insert(schema.guildBotSettings).values({ guildId }).onConflictDoNothing().returning();
		return created[0] ?? emptySettings(guildId);
	}

	public static async update(
		guildId: string,
		data: Partial<Pick<GuildBotSettingsData, "avatarUrl" | "bio" | "bannerUrl" | "baselineAvatarUrl" | "baselineBio" | "baselineBannerUrl" | "baselineCapturedAt">>,
	): Promise<GuildBotSettingsData> {
		await GuildBotSettings.get(guildId);
		const rows = await db
			.update(schema.guildBotSettings)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(schema.guildBotSettings.guildId, guildId))
			.returning();
		if (!rows[0]) throw new Error("Guild bot settings update did not return a row");
		return rows[0];
	}

	public static async captureBaseline(guildId: string, baseline: { avatarUrl: string | null; bio: string | null; bannerUrl: string | null }): Promise<GuildBotSettingsData> {
		await GuildBotSettings.get(guildId);
		await db
			.update(schema.guildBotSettings)
			.set({
				baselineAvatarUrl: baseline.avatarUrl,
				baselineBio: baseline.bio,
				baselineBannerUrl: baseline.bannerUrl,
				baselineCapturedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(and(eq(schema.guildBotSettings.guildId, guildId), isNull(schema.guildBotSettings.baselineCapturedAt)));
		return GuildBotSettings.get(guildId);
	}

	public static async reset(guildId: string): Promise<void> {
		await GuildBotSettings.update(guildId, { avatarUrl: null, bio: null, bannerUrl: null });
	}
}
