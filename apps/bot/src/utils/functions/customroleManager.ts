import { CustomRole, Roles } from "@repo/db";
import { Message, GuildMember, PermissionsBitField, PermissionResolvable, ChannelType } from "discord.js";

const TICK = "<:tick:1533150498973155490>";

/** Dangerous permissions that a custom role must never have. */
const DANGER_PERMISSIONS: PermissionResolvable[] = [
	"Administrator",
	"ManageGuild",
	"ManageRoles",
	"ManageChannels",
	"BanMembers",
	"KickMembers",
	"ManageMessages",
	"MentionEveryone",
	"ManageWebhooks",
];

// Permissions required to use role aliases
const REQUIRED_PERMISSIONS = [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.ManageGuild];

export async function handleRoleAlias(message: Message) {
	if (message.author.bot || !message.guild) return;

	const botMember = await message.guild.members.fetchMe();
	if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

	const guildRoles = await CustomRole.get(message.guild.id);
	if (!guildRoles || !guildRoles.roles?.length || !guildRoles.roles[0]) return;

	const rolesConfig = guildRoles.roles;
	const managerRoleId = guildRoles.managerRole;

	const authorMember = await message.guild.members.fetch(message.author.id);
	const hasPermission =
		authorMember.permissions.any(REQUIRED_PERMISSIONS) ||
		(managerRoleId && authorMember.roles.cache.has(managerRoleId));

	if (!hasPermission) return;

	// Handle reply-based role assignment
	if (message.reference?.messageId) {
		await handleReplyRoleAssignment(message, rolesConfig, botMember);
		return;
	}

	await handleAliasCommand(message, rolesConfig, botMember);
}

async function handleReplyRoleAssignment(message: Message, rolesConfig: Roles[], botMember: GuildMember) {
	try {
		const repliedMessage = await message.channel.messages.fetch(message.reference!.messageId!);
		if (!repliedMessage || repliedMessage.author.bot) return;

		const content = message.content.trim();
		const alias = content.split(/\s+/)[0]?.toLowerCase();

		const matchingRole = rolesConfig.find(role =>
			role.aliase?.toLowerCase() === alias
		);

		if (!matchingRole) return;

		// Force-fetch to get fresh role state
		const targetMember = await message.guild!.members.fetch({ user: repliedMessage.author.id, force: true });
		if (!targetMember) return;

		await assignRole(message, targetMember, matchingRole.role, botMember);
	} catch (error) {
		console.error("Error in reply role assignment:", error);
	}
}


async function handleAliasCommand(message: Message, rolesConfig: Roles[], botMember: GuildMember) {
	const content = message.content.trim();

	// Only allow messages that START with the alias followed by a mention or ID
	const aliasMatch = content.match(/^(\S+)\s+(?:<@!?(\d+)>|(\d+))$/);
	if (!aliasMatch) return;

	const [_, alias, mentionedUserId, directUserId] = aliasMatch;
	const userId = mentionedUserId || directUserId;

	const matchingRole = rolesConfig.find(role =>
		role.aliase?.toLowerCase() === alias?.toLowerCase()
	);

	if (!matchingRole) return;

	try {
		// Force-fetch to get fresh role state
		const targetMember = await message.guild!.members.fetch({ user: userId!, force: true });
		if (!targetMember) {
			await reply(message, `User not found or not in the server.`);
			return;
		}

		await assignRole(message, targetMember, matchingRole.role, botMember);
	} catch (error) {
		console.error("Error in alias command:", error);
		await reply(message, `User not found or not in the server.`);
	}
}


async function assignRole(message: Message, member: GuildMember, roleId: string, botMember: GuildMember) {
	try {
		const role = member.guild.roles.cache.get(roleId);
		if (!role) return;

		// Block assignment if role has dangerous permissions
		const hasDangerous = DANGER_PERMISSIONS.some(perm => role.permissions.has(perm));
		if (hasDangerous) {
			await reply(message, `Can't assign <@&${role.id}> — it has dangerous permissions.`);
			return;
		}

		if (role.position >= botMember.roles.highest.position) {
			await reply(message, `I can't manage <@&${role.id}> because it's above my highest role.`);
			return;
		}

		if (!member.roles.cache.has(role.id)) {
			await member.roles.add(role, `Custom role by ${message.author.username}`);
			await reply(message, `${TICK} Added <@&${role.id}> to <@${member.id}>`);
		} else {
			await member.roles.remove(role, `Custom role by ${message.author.username}`);
			await reply(message, `${TICK} Removed <@&${role.id}> from <@${member.id}>`);
		}
	} catch (error) {
		console.error(`Error assigning role to ${member.user.tag}:`, error);
	}
}

async function reply(message: Message, text: string) {
	if (message.channel.type !== ChannelType.GuildText) return;
	await message.channel.send({ content: `-# ${text}`, allowedMentions: { parse: [] } });
}