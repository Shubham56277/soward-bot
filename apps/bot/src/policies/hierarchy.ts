import type { GuildMember } from 'discord.js';

/**
 * Hierarchy Policy - Centralized permission and role hierarchy checks
 * Prevents duplicate hierarchy checks across moderation commands
 */

export class HierarchyPolicy {
	/**
	 * Check if moderator can perform action on target
	 * @param moderator - The member performing the action
	 * @param target - The target member
	 * @returns Object with allowed status and reason if not allowed
	 */
	static canModerate(moderator: GuildMember, target: GuildMember): { allowed: boolean; reason?: string } {
		// Check if target is the guild owner
		if (target.id === target.guild.ownerId) {
			return { allowed: false, reason: 'Cannot moderate the server owner' };
		}

		// Check if moderator is the guild owner (owner can do anything)
		if (moderator.id === target.guild.ownerId) {
			return { allowed: true };
		}

		// Check if target has higher role than moderator
		if (target.roles.highest.position >= moderator.roles.highest.position) {
			return { allowed: false, reason: 'Cannot moderate members with equal or higher roles' };
		}

		// Check if moderator has administrator permission
		if (!moderator.permissions.has('Administrator')) {
			return { allowed: false, reason: 'Missing administrator permission' };
		}

		return { allowed: true };
	}

	/**
	 * Check if member can manage a specific role
	 * @param member - The member trying to manage the role
	 * @param roleId - The role ID to check
	 * @returns Object with allowed status and reason if not allowed
	 */
	static canManageRole(member: GuildMember, roleId: string): { allowed: boolean; reason?: string } {
		const role = member.guild.roles.cache.get(roleId);
		
		if (!role) {
			return { allowed: false, reason: 'Role not found' };
		}

		if (role.managed) {
			return { allowed: false, reason: 'Cannot manage integration roles' };
		}

		if (member.id !== member.guild.ownerId) {
			if (role.position >= member.roles.highest.position) {
				return { allowed: false, reason: 'Cannot manage roles equal to or higher than your highest role' };
			}
		}

		if (!member.permissions.has('ManageRoles')) {
			return { allowed: false, reason: 'Missing manage roles permission' };
		}

		return { allowed: true };
	}

	/**
	 * Check if member is protected by AntiNuke or trusted status
	 * @param target - The target member to check
	 * @returns Whether the member is protected
	 */
	static async isProtected(target: GuildMember): Promise<boolean> {
		// Import AntiNuke service dynamically to avoid circular dependencies
		const { AntiNukeService } = await import('../services/security/antiNukeService');
		return AntiNukeService.isTrusted(target.guild.id, target.id);
	}

	/**
	 * Check if member has any of the required permissions
	 * @param member - The member to check
	 * @param permissions - Array of permission strings
	 * @returns Whether member has any of the permissions
	 */
	static hasAnyPermission(member: GuildMember, permissions: string[]): boolean {
		return permissions.some(perm => member.permissions.has(perm as any));
	}

	/**
	 * Check if member has all required permissions
	 * @param member - The member to check
	 * @param permissions - Array of permission strings
	 * @returns Whether member has all permissions
	 */
	static hasAllPermissions(member: GuildMember, permissions: string[]): boolean {
		return permissions.every(perm => member.permissions.has(perm as any));
	}
}
