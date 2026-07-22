import { ModerationCaseService } from './moderationCaseService';
import { HierarchyPolicy } from '../../policies/hierarchy';
import type { GuildMember, User } from 'discord.js';

/**
 * Moderation Service - Centralized moderation operations
 */
export class ModerationService {
	/**
	 * Ban a member with case creation
	 */
	static async ban(
		moderator: GuildMember,
		target: User,
		reason: string,
		deleteMessageDays = 1
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		const guild = moderator.guild;
		
		// Check hierarchy
		const member = guild.members.cache.get(target.id);
		if (member) {
			const check = HierarchyPolicy.canModerate(moderator, member);
			if (!check.allowed) {
				return { success: false, error: check.reason };
			}
		}

		try {
			await guild.members.ban(target.id, {
				deleteMessageDays,
				reason: `${reason} | Moderator: ${moderator.user.tag}`,
			});

			// Create case
			const caseId = await ModerationCaseService.createCase({
				guildId: guild.id,
				targetId: target.id,
				moderatorId: moderator.id,
				action: 'ban',
				reason,
			});

			return { success: true, caseId };
		} catch (error) {
			return { success: false, error: 'Failed to ban member' };
		}
	}

	/**
	 * Kick a member with case creation
	 */
	static async kick(
		moderator: GuildMember,
		target: GuildMember,
		reason: string
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		const check = HierarchyPolicy.canModerate(moderator, target);
		if (!check.allowed) {
			return { success: false, error: check.reason };
		}

		try {
			await target.kick(`${reason} | Moderator: ${moderator.user.tag}`);

			const caseId = await ModerationCaseService.createCase({
				guildId: target.guild.id,
				targetId: target.id,
				moderatorId: moderator.id,
				action: 'kick',
				reason,
			});

			return { success: true, caseId };
		} catch (error) {
			return { success: false, error: 'Failed to kick member' };
		}
	}

	/**
	 * Timeout a member with case creation
	 */
	static async timeout(
		moderator: GuildMember,
		target: GuildMember,
		duration: number,
		reason: string
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		const check = HierarchyPolicy.canModerate(moderator, target);
		if (!check.allowed) {
			return { success: false, error: check.reason };
		}

		try {
			await target.timeout(duration, `${reason} | Moderator: ${moderator.user.tag}`);

			const caseId = await ModerationCaseService.createCase({
				guildId: target.guild.id,
				targetId: target.id,
				moderatorId: moderator.id,
				action: 'timeout',
				reason,
				duration,
			});

			return { success: true, caseId };
		} catch (error) {
			return { success: false, error: 'Failed to timeout member' };
		}
	}

	/**
	 * Warn a member with case creation
	 */
	static async warn(
		moderator: GuildMember,
		target: GuildMember,
		reason: string
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		// Check hierarchy (warnings don't require as strict checks, but still need some)
		if (target.id === target.guild.ownerId) {
			return { success: false, error: 'Cannot warn the server owner' };
		}

		const caseId = await ModerationCaseService.createCase({
			guildId: target.guild.id,
			targetId: target.id,
			moderatorId: moderator.id,
			action: 'warn',
			reason,
		});

		return { success: true, caseId };
	}

	/**
	 * Softban a member (ban and immediately unban to purge messages)
	 */
	static async softban(
		moderator: GuildMember,
		target: User,
		reason: string
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		const guild = moderator.guild;
		const member = guild.members.cache.get(target.id);
		
		if (member) {
			const check = HierarchyPolicy.canModerate(moderator, member);
			if (!check.allowed) {
				return { success: false, error: check.reason };
			}
		}

		try {
			// Ban with 7 days message deletion
			await guild.members.ban(target.id, {
				deleteMessageDays: 7,
				reason: `Softban: ${reason} | Moderator: ${moderator.user.tag}`,
			});

			// Immediately unban
			await guild.members.unban(target.id, 'Softban - removing ban');

			const caseId = await ModerationCaseService.createCase({
				guildId: guild.id,
				targetId: target.id,
				moderatorId: moderator.id,
				action: 'softban',
				reason,
			});

			return { success: true, caseId };
		} catch (error) {
			return { success: false, error: 'Failed to softban member' };
		}
	}

	/**
	 * Unban a user
	 */
	static async unban(
		moderator: GuildMember,
		userId: string,
		reason: string
	): Promise<{ success: boolean; caseId?: string; error?: string }> {
		const guild = moderator.guild;

		try {
			await guild.members.unban(userId, `${reason} | Moderator: ${moderator.user.tag}`);

			const caseId = await ModerationCaseService.createCase({
				guildId: guild.id,
				targetId: userId,
				moderatorId: moderator.id,
				action: 'unban',
				reason,
			});

			return { success: true, caseId };
		} catch (error) {
			return { success: false, error: 'User is not banned or failed to unban' };
		}
	}
}
