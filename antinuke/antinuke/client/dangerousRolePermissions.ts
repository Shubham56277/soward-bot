import { PermissionFlagsBits, Role } from "discord.js";

export const DANGEROUS_AUTO_ASSIGN_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
] as const;

export function isDangerousAutoAssignRole(role: Role): boolean {
  return DANGEROUS_AUTO_ASSIGN_ROLE_PERMISSIONS.some((permission) => role.permissions.has(permission));
}