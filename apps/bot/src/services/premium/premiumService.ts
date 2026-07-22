import { db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { premium } from '@repo/db';

/**
 * Premium Service - Premium status and features
 */
export class PremiumService {
	/**
	 * Check if user has premium status
	 */
	static async isUserPremium(userId: string): Promise<boolean> {
		const result = await db
			.select()
			.from(premium)
			.where(eq(premium.userId, userId))
			.limit(1);

		if (!result[0]) return false;

		const user = result[0];
		if (!user.isPremium) return false;

		// Check if premium has expired
		if (user.premiumUntil && new Date() > user.premiumUntil) {
			// Update expired premium
			await db
				.update(premium)
				.set({ isPremium: false })
				.where(eq(premium.userId, userId));
			return false;
		}

		return true;
	}

	/**
	 * Get premium expiry date
	 */
	static async getPremiumExpiry(userId: string): Promise<Date | null> {
		const result = await db
			.select()
			.from(premium)
			.where(eq(premium.userId, userId))
			.limit(1);

		return result[0]?.premiumUntil ?? null;
	}

	/**
	 * Grant premium to user
	 */
	static async grantPremium(userId: string, durationMs: number): Promise<void> {
		const now = new Date();
		const expiry = new Date(now.getTime() + durationMs);

		await db
			.insert(premium)
			.values({
				userId,
				isPremium: true,
				premiumSince: now,
				premiumUntil: expiry,
			})
			.onConflictDoUpdate({
				target: premium.userId,
				set: {
					isPremium: true,
					premiumSince: now,
					premiumUntil: expiry,
				},
			});
	}

	/**
	 * Revoke premium from user
	 */
	static async revokePremium(userId: string): Promise<void> {
		await db
			.update(premium)
			.set({ isPremium: false })
			.where(eq(premium.userId, userId));
	}
}
