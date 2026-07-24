import { GuildBan } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import logger from "../../utils/logger";

export default class AntiNukeBanRemoveListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildBanRemove",
      once: false,
    });
  }

  public async run(ban: GuildBan): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      ban.guild,
      "banRemove",
      `banRemove:${ban.user.tag}`,
      { targetId: ban.user.id },
    );

    // Auto-recovery: re-ban the member if the unban was unauthorized
    if (protection.enforced) {
      const autoRecovery = await isAutoRecoveryEnabled(ban.guild.id);
      if (autoRecovery) {
        try {
          await ban.guild.members.ban(ban.user.id, {
            reason: "[ANTINUKE] Auto-recovery | Reversing unauthorized unban",
          });
          await sendRecoveryReport(
            ban.guild,
            "Unban Reversed",
            `Re-banned <@${ban.user.id}> (\`${ban.user.tag}\`) after unauthorized unban was detected.`,
          );
        } catch (err) {
          logger.debug(`[ ANTINUKE ] Failed to re-ban ${ban.user.id} in ${ban.guild.id}: ${err}`);
        }
      }
    }
  }
}
