import type Redis from "ioredis";

/**
 * Guaranteed Winners Store
 * 
 * Stores guaranteed winner user IDs globally in Redis.
 * Only the bot owner/developer can configure these.
 * When a giveaway ends, guaranteed users who actually joined
 * are selected first, with remaining slots filled randomly.
 */

const GUARANTEED_WINNERS_KEY = "giveaway:guaranteed_winners";

export class GuaranteedWinnersStore {
	private redis: Redis;

	constructor(redis: Redis) {
		this.redis = redis;
	}

	/**
	 * Add a user ID to the global guaranteed winners list
	 */
	async add(userId: string): Promise<boolean> {
		const added = await this.redis.sadd(GUARANTEED_WINNERS_KEY, userId);
		return added > 0;
	}

	/**
	 * Remove a user ID from the global guaranteed winners list
	 */
	async remove(userId: string): Promise<boolean> {
		const removed = await this.redis.srem(GUARANTEED_WINNERS_KEY, userId);
		return removed > 0;
	}

	/**
	 * Get all guaranteed winner user IDs
	 */
	async list(): Promise<string[]> {
		return await this.redis.smembers(GUARANTEED_WINNERS_KEY);
	}

	/**
	 * Clear all guaranteed winners
	 */
	async clear(): Promise<number> {
		const count = await this.redis.scard(GUARANTEED_WINNERS_KEY);
		await this.redis.del(GUARANTEED_WINNERS_KEY);
		return count;
	}

	/**
	 * Check if a user is a guaranteed winner
	 */
	async has(userId: string): Promise<boolean> {
		return (await this.redis.sismember(GUARANTEED_WINNERS_KEY, userId)) === 1;
	}

	/**
	 * Get count of guaranteed winners
	 */
	async count(): Promise<number> {
		return await this.redis.scard(GUARANTEED_WINNERS_KEY);
	}
}

export interface WinnerSelectionResult {
	winners: { id: string }[];
	method: "guaranteed" | "mixed" | "random";
	guaranteedCount: number;
	randomCount: number;
}

/**
 * Select winners from participants, prioritizing guaranteed winners who joined.
 * 
 * @param participants - Array of participants who joined the giveaway
 * @param winnerCount - Number of winners to select
 * @param guaranteedUserIds - Array of guaranteed user IDs
 * @returns WinnerSelectionResult with winners and audit info
 */
export function selectWinnersWithGuaranteed(
	participants: { id: string }[],
	winnerCount: number,
	guaranteedUserIds: string[]
): WinnerSelectionResult {
	const actualWinnerCount = Math.min(winnerCount, participants.length);
	
	if (actualWinnerCount === 0) {
		return { winners: [], method: "random", guaranteedCount: 0, randomCount: 0 };
	}

	// Find guaranteed users who actually participated
	const guaranteedParticipants = participants.filter(p => guaranteedUserIds.includes(p.id));

	// If no guaranteed users joined, fall back to pure random
	if (guaranteedParticipants.length === 0) {
		const randomWinners = pickRandomUnique(participants, actualWinnerCount);
		return {
			winners: randomWinners,
			method: "random",
			guaranteedCount: 0,
			randomCount: randomWinners.length,
		};
	}

	// Select guaranteed winners (up to the winner count)
	const selectedGuaranteed = guaranteedParticipants.slice(0, actualWinnerCount);
	const remainingSlots = actualWinnerCount - selectedGuaranteed.length;

	// Fill remaining slots randomly from non-guaranteed participants
	let randomWinners: { id: string }[] = [];
	if (remainingSlots > 0) {
		const nonGuaranteedParticipants = participants.filter(
			p => !selectedGuaranteed.some(g => g.id === p.id)
		);
		randomWinners = pickRandomUnique(nonGuaranteedParticipants, remainingSlots);
	}

	const allWinners = [...selectedGuaranteed, ...randomWinners];
	const method = randomWinners.length === 0 ? "guaranteed" : "mixed";

	return {
		winners: allWinners,
		method,
		guaranteedCount: selectedGuaranteed.length,
		randomCount: randomWinners.length,
	};
}

/**
 * Pick random unique items from an array without duplicates
 */
function pickRandomUnique<T>(arr: T[], count: number): T[] {
	const shuffled = [...arr].sort(() => 0.5 - Math.random());
	return shuffled.slice(0, count);
}
