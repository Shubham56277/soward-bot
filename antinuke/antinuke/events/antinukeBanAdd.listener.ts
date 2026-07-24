import { GuildBan } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import logger from "../../utils/logger";

export default class AntiNukeBanAddListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildBanAdd",
      once: false,
    });
  }

  public async run(ban: GuildBan): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      ban.guild,
      "banAdd",
      `banAdd:${ban.user.tag}`,
      { targetId: ban.user.id },
    );

    // Auto-recovery: unban the victim if the ban was unauthorized
    if (protection.enforced) {
      const autoRecovery = await isAutoRecoveryEnabled(ban.guild.id);
      if (autoRecovery) {
        try {
          await ban.guild.members.unban(ban.user.id, "[ANTINUKE] Auto-recovery | Reversing unauthorized ban");
          await sendRecoveryReport(
            ban.guild,
            "Ban Reversed",
            `Auto-unbanned <@${ban.user.id}> (\`${ban.user.tag}\`) after unauthorized ban was detected.`,
          );
        } catch (err) {
          logger.debug(`[ ANTINUKE ] Failed to auto-unban ${ban.user.id} in ${ban.guild.id}: ${err}`);
        }
      }
    }
  }
}
