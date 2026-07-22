import type { GuildMember, User } from "discord.js";

/**
 * Result of a moderation guard check.
 */
export interface ModerationGuardResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Shared moderation guard — validates every rule before a moderation action.
 * All moderation commands should use this instead of duplicating checks.
 */
export class ModerationGuard {
	/**
	 * Validate that a moderator can act on a target member.
	 * Comprehensive check covering all edge cases.
	 */
	static canModerate(moderator: GuildMember, target: GuildMember): ModerationGuardResult {
		// 1. Self-target protection
		if (moderator.id === target.id) {
			return { allowed: false, reason: "You cannot moderate yourself." };
		}

		// 2. Bot self-target protection
		if (target.id === moderator.guild.members.me?.id) {
			return { allowed: false, reason: "I cannot moderate myself." };
		}

		// 3. Guild owner protection (even admins can't moderate the owner)
		if (target.id === target.guild.ownerId) {
			return { allowed: false, reason: "Cannot moderate the server owner." };
		}

		// 4. Owner bypass — guild owner can moderate anyone except themselves/owner
		if (moderator.id === moderator.guild.ownerId) {
			return { allowed: true };
		}

		// 5. Moderator must have Administrator permission to moderate in most cases
		// (individual commands may require specific permissions like BanMembers)
		if (!moderator.permissions.has("Administrator")) {
			// Non-admin moderators need specific permission checks per action
			// This is handled by the calling command's permission requirements
		}

		// 6. Target role hierarchy check (target's highest role vs moderator's)
		if (target.roles.highest.position >= moderator.roles.highest.position) {
			return { allowed: false, reason: "Cannot moderate members with equal or higher roles." };
		}

		// 7. Bot role hierarchy check (can the bot act on the target?)
		const botMember = moderator.guild.members.me;
		if (botMember && target.roles.highest.position >= botMember.roles.highest.position) {
			return { allowed: false, reason: "I cannot moderate that member because their highest role is above or equal to mine." };
		}

		return { allowed: true };
	}

	/**
	 * Validate that a moderator can manage a specific role.
	 */
	static canManageRole(moderator: GuildMember, roleId: string): ModerationGuardResult {
		const role = moderator.guild.roles.cache.get(roleId);
		if (!role) {
			return { allowed: false, reason: "Role not found in this server." };
		}

		// Managed roles (e.g., integration roles) cannot be managed manually
		if (role.managed) {
			return { allowed: false, reason: "Cannot manage integration roles." };
		}

		// Owner can manage any role
		if (moderator.id === moderator.guild.ownerId) {
			return { allowed: true };
		}

		// Role position check
		if (role.position >= moderator.roles.highest.position) {
			return { allowed: false, reason: "Cannot manage roles equal to or higher than your highest role." };
		}

		// Bot role position check
		const botMember = moderator.guild.members.me;
		if (botMember && role.position >= botMember.roles.highest.position) {
			return { allowed: false, reason: "I cannot manage that role because it's above or equal to my highest role." };
		}

		// Administrator restriction — dangerous roles
		if (role.permissions.has("Administrator") && moderator.id !== moderator.guild.ownerId) {
			return { allowed: false, reason: "Only the server owner can manage roles with Administrator permission." };
		}

		if (!moderator.permissions.has("ManageRoles")) {
			return { allowed: false, reason: "You need the Manage Roles permission." };
		}

		return { allowed: true };
	}

	/**
	 * Validate a moderation action on a user (not necessarily a cached member).
	 * Handles bans, unbans, softbans where the target may not be in the guild.
	 */
	static canModerateUser(moderator: GuildMember, targetId: string): ModerationGuardResult {
		// Self-target protection
		if (moderator.id === targetId) {
			return { allowed: false, reason: "You cannot perform this action on yourself." };
		}

		// Bot self-target protection
		if (targetId === moderator.guild.members.me?.id) {
			return { allowed: false, reason: "I cannot perform this action on myself." };
		}

		// Guild owner protection
		if (targetId === moderator.guild.ownerId) {
			return { allowed: false, reason: "Cannot moderate the server owner." };
		}

		// If the user is a member in the guild, check hierarchy
		const targetMember = moderator.guild.members.cache.get(targetId);
		if (targetMember) {
			return ModerationGuard.canModerate(moderator, targetMember);
		}

		return { allowed: true };
	}

	/**
	 * Check if a member is protected (trusted, co-owner, etc.)
	 */
	/**
	 * Check if a member is protected (trusted, co-owner, etc.)
	 * TODO: Re-integrate with AntiNukeService once circular dependency is resolved.
	 * The antiNukeService.ts file has pre-existing type issues that need fixing first.
	 * Currently returns false (no protection bypass) which is the safe default.
	 */
	static async isProtected(_target: GuildMember): Promise<boolean> {
		return false;
	}

	/**
	 * Validate a channel moderation action (lock, unlock, hide, unhide).
	 */
	static canModerateChannel(moderator: GuildMember): ModerationGuardResult {
		if (moderator.id === moderator.guild.ownerId) {
			return { allowed: true };
		}

		if (!moderator.permissions.has("ManageChannels")) {
			return { allowed: false, reason: "You need the Manage Channels permission." };
		}

		return { allowed: true };
	}

	/**
	 * Validate a nickname change.
	 */
	static canModerateNickname(moderator: GuildMember, target: GuildMember): ModerationGuardResult {
		return ModerationGuard.canModerate(moderator, target);
	}

	/**
	 * Validate timeout action.
	 */
	static canTimeout(moderator: GuildMember, target: GuildMember): ModerationGuardResult {
		const check = ModerationGuard.canModerate(moderator, target);
		if (!check.allowed) return check;

		if (!moderator.permissions.has("ModerateMembers")) {
			return { allowed: false, reason: "You need the Moderate Members permission." };
		}

		const botMember = moderator.guild.members.me;
		if (!botMember?.permissions.has("ModerateMembers")) {
			return { allowed: false, reason: "I need the Moderate Members permission." };
		}

		return { allowed: true };
	}
}
