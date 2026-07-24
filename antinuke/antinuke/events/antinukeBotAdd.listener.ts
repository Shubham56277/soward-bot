import { GuildMember, UserFlagsBitField, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { getAntiNukeConfig } from "../client/antinukeStore";
import { isGuildPremiumActive } from "../../utils/premiumGuard";
import logger from "../../utils/logger";

export default class AntiNukeBotAddListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberAdd",
      once: false,
    });
  }

  public async run(member: GuildMember): Promise<void> {
    if (!member.user.bot) return;

    // ── Anti Unverified Bot filter ──────────────────────────────────────────
    // Checks if the added bot lacks the VERIFIED_BOT flag and kicks it
    try {
      const premiumActive = await isGuildPremiumActive(member.guild.id);
      if (premiumActive) {
        const config = await getAntiNukeConfig(member.guild.id);
        if (config?.enabled) {
          const isUnverifiedFilterOn = Boolean((config.moduleStates as any)?.antiUnverifiedBot);
          if (isUnverifiedFilterOn) {
            const flags = member.user.flags ?? new UserFlagsBitField(0);
            const isVerified = flags.has("VerifiedBot");
            if (!isVerified) {
              const auditLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 3 }).catch(() => null);
              const logEntry = auditLogs?.entries.find(e => e.target?.id === member.id && Date.now() - e.createdTimestamp < 30000);
              const executorId = logEntry?.executorId || logEntry?.executor?.id;

              // Skip if the executor is the guild owner or the bot itself
              if (executorId === member.guild.ownerId || executorId === this.client.user?.id) {
                // Allowed, bypass the ban
              } else {
                await member.ban({ reason: "[ANTINUKE] Anti-Unverified Bot | Unverified bot addition blocked" }).catch(() => null);
                logger.info(`[ ANTINUKE ] Banned unverified bot ${member.user.tag} in ${member.guild.id} (added by ${executorId || "unknown"})`);
                return; // Don't also trigger botAdd protection below
              }
            }
          }
        }
      }
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Anti-unverified bot check failed: ${err}`);
    }

    // ── Standard botAdd protection ──────────────────────────────────────────
    const protection = await runAntiNukeProtectionDetailed(this.client, member.guild, "botAdd", `botAdd:${member.user.tag}`);

    // Auto-recovery: also ban the illegally-added bot itself
    if (protection.enforcedNow) {
      const autoRecovery = await isAutoRecoveryEnabled(member.guild.id);
      if (autoRecovery) {
        try {
          await member.ban({ reason: "[ANTINUKE] Auto-recovery | Removing illegally-added bot" }).catch(() => null);
          await sendRecoveryReport(
            member.guild,
            "Illegal Bot Removed",
            `Banned illegally-added bot <@${member.id}> (\`${member.user.tag}\`) after unauthorized bot addition.`,
          );
        } catch (err) {
          logger.debug(`[ ANTINUKE ] Failed to ban illegal bot ${member.id} in ${member.guild.id}: ${err}`);
        }
      }
    }
  }
}
