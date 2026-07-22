import { db } from '@repo/db';
import { moderationCases } from "@repo/db";
import { eq, and, desc, sql } from 'drizzle-orm';
import type { GuildMember, User } from 'discord.js';
import { generateId } from '../../utils/helper';

/**
 * Moderation Case Service - Manages moderation case IDs and history
 */
export class ModerationCaseService {
	/**
	 * Create a new moderation case
	 */
	static async createCase(data: {
		guildId: string;
		targetId: string;
		moderatorId: string;
		action: 'warn' | 'kick' | 'ban' | 'timeout' | 'unban' | 'mute' | 'unmute' | 'softban';
		reason: string;
		duration?: number;
		extra?: Record<string, any>;
	}): Promise<string> {
		const caseId = await ModerationCaseService.getNextCaseId(data.guildId);
		
		await db.insert(moderationCases).values({
			id: generateId(),
			caseId,
			guildId: data.guildId,
			targetId: data.targetId,
			moderatorId: data.moderatorId,
			action: data.action,
			reason: data.reason,
			duration: data.duration,
			extra: data.extra,
			createdAt: new Date(),
		});

		return caseId;
	}

	/**
	 * Get next case ID for guild
	 */
	private static async getNextCaseId(guildId: string): Promise<number> {
		const result = await db
			.select({ maxCaseId: sql<number>`COALESCE(MAX(${moderationCases.caseId}), 0)` })
			.from(moderationCases)
			.where(eq(moderationCases.guildId, guildId));

		return (result[0]?.maxCaseId ?? 0) + 1;
	}

	/**
	 * Get case by case ID
	 */
	static async getCase(guildId: string, caseId: number) {
		const result = await db
			.select()
			.from(moderationCases)
			.where(and(
				eq(moderationCases.guildId, guildId),
				eq(moderationCases.caseId, caseId)
			))
			.limit(1);

		return result[0];
	}

	/**
	 * Get all cases for a user in a guild
	 */
	static async getUserCases(guildId: string, userId: string, limit = 10) {
		return db
			.select()
			.from(moderationCases)
			.where(and(
				eq(moderationCases.guildId, guildId),
				eq(moderationCases.targetId, userId)
			))
			.orderBy(desc(moderationCases.createdAt))
			.limit(limit);
	}

	/**
	 * Get all cases for a guild
	 */
	static async getGuildCases(guildId: string, limit = 25) {
		return db
			.select()
			.from(moderationCases)
			.where(eq(moderationCases.guildId, guildId))
			.orderBy(desc(moderationCases.createdAt))
			.limit(limit);
	}

	/**
	 * Resolve a case
	 */
	static async resolveCase(guildId: string, caseId: number, resolvedBy: string, resolution: string) {
		const case_ = await ModerationCaseService.getCase(guildId, caseId);
		if (!case_) {
			throw new Error('Case not found');
		}

		await db
			.update(moderationCases)
			.set({
				resolved: true,
				resolvedBy,
				resolvedAt: new Date(),
				resolution,
				updatedAt: new Date(),
			})
			.where(and(
				eq(moderationCases.guildId, guildId),
				eq(moderationCases.caseId, caseId)
			));

		return case_;
	}

	/**
	 * Get moderation statistics for a guild
	 */
	static async getStats(guildId: string) {
		const stats = await db
			.select({
				action: moderationCases.action,
				count: sql<number>`COUNT(*)`,
			})
			.from(moderationCases)
			.where(eq(moderationCases.guildId, guildId))
			.groupBy(moderationCases.action);

		return stats.reduce((acc, stat) => {
			acc[stat.action] = stat.count;
			return acc;
		}, {} as Record<string, number>);
	}
}
