import { Premium } from '@repo/db';

/**
 * Premium Service - Premium status and features
 */
export class PremiumService {
	/**
	 * Check if user has premium status
	 */
	static async isUserPremium(userId: string): Promise<boolean> {
		return Premium.hasPremium(userId);
	}

	/**
	 * Get premium expiry date
	 */
	static async getPremiumExpiry(userId: string): Promise<Date | null> {
		const premium = await Premium.get(userId);
		return premium.premiumUntil ?? null;
	}

	/**
	 * Grant premium to user
	 */
	static async grantPremium(userId: string, durationMs: number): Promise<void> {
		await Premium.activatePremium(userId, durationMs);
	}

	/**
	 * Revoke premium from user
	 */
	static async revokePremium(userId: string): Promise<void> {
		await Premium.revokePremium(userId);
	}
}
