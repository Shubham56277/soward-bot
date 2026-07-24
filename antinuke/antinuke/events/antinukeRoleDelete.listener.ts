import { Role } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { isAutoRecoveryEnabled, recoverDeletedRole, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeRoleDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "roleDelete",
      once: false,
    });
  }

  public async run(role: Role): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      role.guild,
      "roleDelete",
      `roleDelete:${role.name}`,
      { targetId: role.id },
    );
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(role.guild.id);
    if (!autoRecoveryEnabled) return;

    const recovery = await recoverDeletedRole(role);
    if (!recovery.recovered) {
      await sendRecoveryReport(role.guild, "Role Recovery Failed", recovery.details);
      return;
    }

    await sendRecoveryReport(role.guild, "Role Restored", recovery.details);
  }
}
