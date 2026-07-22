import type { GuildMember, ChatInputCommandInteraction } from 'discord.js';

/**
 * Permissions Policy - Centralized permission checks
 */
export class PermissionsPolicy {
	/**
	 * Check if member has moderation permissions
	 */
	static isModerator(member: GuildMember): boolean {
		return member.permissions.has([
			'ModerateMembers',
			'KickMembers',
			'BanMembers',
			'ManageGuild',
		]);
	}

	/**
	 * Check if member is guild admin
	 */
	static isGuildAdmin(member: GuildMember): boolean {
		return member.permissions.has('Administrator') || member.id === member.guild.ownerId;
	}

	/**
	 * Check if member is bot developer
	 */
	static isDeveloper(member: GuildMember, developerIds: string[]): boolean {
		return developerIds.includes(member.id);
	}

	/**
	 * Check if member has premium status
	 */
	static async isPremium(member: GuildMember): Promise<boolean> {
		// Import premium service dynamically
		const { PremiumService } = await import('../services/premium/premiumService');
		return PremiumService.isUserPremium(member.id);
	}

	/**
	 * Require specific permissions, throwing error if missing
	 */
	static requirePermissions(interaction: ChatInputCommandInteraction, permissions: string[]): void {
		const member = interaction.member as GuildMember;
		const missing = permissions.filter(perm => !member.permissions.has(perm as any));
		
		if (missing.length > 0) {
			throw new Error(`Missing permissions: ${missing.join(', ')}`);
		}
	}

	/**
	 * Check if bot has required permissions
	 */
	static botHasPermission(guild: any, permissions: string[]): { has: boolean; missing: string[] } {
		const botMember = guild.members.me;
		if (!botMember) {
			return { has: false, missing: permissions };
		}

		const missing = permissions.filter(perm => !botMember.permissions.has(perm as any));
		return { has: missing.length === 0, missing };
	}
}
