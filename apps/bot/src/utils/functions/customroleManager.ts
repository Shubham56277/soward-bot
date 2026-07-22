import { CustomRole, Roles } from "@repo/db";
import { Message, GuildMember, PermissionsBitField, PermissionResolvable, ChannelType } from "discord.js";

// Dangerous permissions that should never be assigned via alias
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

		// Only allow alias if it's the first word in the reply message
		const alias = content.split(/\s+/)[0]?.toLowerCase();

		const matchingRole = rolesConfig.find(role =>
			role.aliase?.toLowerCase() === alias
		);

		if (!matchingRole) return;

		const targetMember = await message.guild!.members.fetch(repliedMessage.author.id);
		if (!targetMember) return;

		await assignRoleIfSafe(message, targetMember, matchingRole.role, botMember);
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
		const targetMember = await message.guild!.members.fetch(userId!);
		if (!targetMember) {
			await sendEmbed(message, "red", "User not found or not in the server");
			return;
		}

		await assignRoleIfSafe(message, targetMember, matchingRole.role, botMember);
	} catch (error) {
		console.error("Error in alias command:", error);
		await sendEmbed(message, "red", "User not found or not in the server");
	}
}


async function assignRoleIfSafe(message: Message, member: GuildMember, roleId: string, botMember: GuildMember) {
	try {
		const role = member.guild.roles.cache.get(roleId);
		if (!role) {
			console.log(`Role ${roleId} not found in guild`);
			return;
		}

		const hasDangerousPermission = DANGER_PERMISSIONS.some((perm) => role.permissions.has(perm));
		if (hasDangerousPermission) {
			await sendEmbed(message, "red", `Role <@&${role.id}> has dangerous permissions`);
			return;
		}

		if (role.position >= botMember.roles.highest.position) {
			await sendEmbed(message, "red", `I don't have permission to assign <@&${role.id}> to <@${member.id}>`);
			return;
		}

		if (!member.roles.cache.has(role.id)) {
			await member.roles.add(role, "Custom Role");
			await sendEmbed(message, "main", `Successfully Given <@&${role.id}> to <@${member.id}>`);
		} else {
			await member.roles.remove(role, "Custom Role");
			await sendEmbed(message, "main", `Successfully Removed <@&${role.id}> from <@${member.id}>`);
		}
	} catch (error) {
		console.error(`Error assigning role to ${member.user.tag}:`, error);
	}
}

async function sendEmbed(message: Message, color: "red" | "main", description: string) {
	if (message.channel.type !== ChannelType.GuildText) return;
	
	await message.channel.send({
		embeds: [
			{
				color: message.client.config.colors[color],
				author: {
					name: message.author.username,
					icon_url: message.author.avatarURL()!,
				},
				description,
			},
		],
	});
}