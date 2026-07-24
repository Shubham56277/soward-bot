import { PermissionFlagsBits, Role } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { isAutoRecoveryEnabled, restoreUpdatedRole, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

const DANGEROUS_ROLE_LINK_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
];

export default class AntiNukeRoleUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "roleUpdate",
      once: false,
    });
  }

  public async run(oldRole: Role, newRole: Role): Promise<void> {
    const permissionsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
    const mentionabilityChanged = oldRole.mentionable !== newRole.mentionable;
    const changed = oldRole.name !== newRole.name
      || oldRole.color !== newRole.color
      || oldRole.hoist !== newRole.hoist
      || mentionabilityChanged
      || permissionsChanged;

    if (!changed) return;

    const hasDangerousPermissionEscalation = permissionsChanged && DANGEROUS_ROLE_LINK_PERMISSIONS
      .some((permission) => !oldRole.permissions.has(permission) && newRole.permissions.has(permission));

    const action = hasDangerousPermissionEscalation ? "linkRole" : "roleUpdate";
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      newRole.guild,
      action,
      `${action}:${oldRole.name}->${newRole.name}`,
      { targetId: newRole.id },
    );

    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(newRole.guild.id);
    if (!autoRecoveryEnabled) return;

    const restored = await restoreUpdatedRole(oldRole, newRole);
    if (!restored) {
      await sendRecoveryReport(
        newRole.guild,
        "Role Revert Failed",
        `Failed to restore role: **${oldRole.name}**. Check role hierarchy and Manage Roles permission.`,
      );
      return;
    }

    await sendRecoveryReport(newRole.guild, "Role Reverted", `Restored role: **${oldRole.name}**`);
  }
}
