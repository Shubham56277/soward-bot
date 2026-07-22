import { db } from '@repo/db';
import { AntiNuke } from '@repo/db';
import { eq } from 'drizzle-orm';

/**
 * AntiNuke Service - Security and AntiNuke operations
 */
export class AntiNukeService {
	/**
	 * Check if AntiNuke is enabled for a guild
	 */
	static async isEnabled(guildId: string): Promise<boolean> {
		const result = await db
			.select({ enabled: AntiNuke.enabled })
			.from(AntiNuke)
			.where(eq(AntiNuke.guildId, guildId))
			.limit(1);

		return result[0]?.enabled ?? false;
	}

	/**
	 * Check if user is trusted
	 */
	static async isTrusted(guildId: string, userId: string): Promise<boolean> {
		const result = await db
			.select({ trustedUsers: AntiNuke.trustedUsers })
			.from(AntiNuke)
			.where(eq(AntiNuke.guildId, guildId))
			.limit(1);

		return result[0]?.trustedUsers?.includes(userId) ?? false;
	}

	/**
	 * Add trusted user
	 */
	static async addTrustedUser(guildId: string, userId: string): Promise<void> {
		const current = await db
			.select()
			.from(AntiNuke)
			.where(eq(AntiNuke.guildId, guildId))
			.limit(1);

		const trustedUsers = current[0]?.trustedUsers ?? [];
		if (!trustedUsers.includes(userId)) {
			trustedUsers.push(userId);
			await db
				.update(AntiNuke)
				.set({ trustedUsers })
				.where(eq(AntiNuke.guildId, guildId));
		}
	}

	/**
	 * Remove trusted user
	 */
	static async removeTrustedUser(guildId: string, userId: string): Promise<void> {
		const current = await db
			.select()
			.from(AntiNuke)
			.where(eq(AntiNuke.guildId, guildId))
			.limit(1);

		const trustedUsers = current[0]?.trustedUsers?.filter(id => id !== userId) ?? [];
		await db
			.update(AntiNuke)
			.set({ trustedUsers })
			.where(eq(AntiNuke.guildId, guildId));
	}

	/**
	 * Enable/disable AntiNuke
	 */
	static async setEnabled(guildId: string, enabled: boolean): Promise<void> {
		await db
			.update(AntiNuke)
			.set({ enabled })
			.where(eq(AntiNuke.guildId, guildId));
	}

	/**
	 * Get AntiNuke configuration
	 */
	static async getConfig(guildId: string) {
		const result = await db
			.select()
			.from(AntiNuke)
			.where(eq(AntiNuke.guildId, guildId))
			.limit(1);

		return result[0];
	}
}
