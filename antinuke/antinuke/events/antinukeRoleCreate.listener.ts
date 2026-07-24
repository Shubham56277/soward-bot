import { Role } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedRole, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeRoleCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "roleCreate",
      once: false,
    });
  }

  public async run(role: Role): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      role.guild,
      "roleCreate",
      `roleCreate:${role.name}`,
      { targetId: role.id },
    );
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(role.guild.id);
    if (!autoRecoveryEnabled) return;

    const cleaned = await cleanupUnauthorizedRole(role);
    if (!cleaned) return;

    await sendRecoveryReport(role.guild, "Unauthorized Role Removed", `Cleaned up unauthorized role: **${role.name}**`);
  }
}
