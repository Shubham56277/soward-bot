import { GuildMember, GuildMemberFlags } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, isRecoveryInProgress, restoreMemberRoles, sendRecoveryReport, getCachedMemberRoleAuditLogs } from "../modules/antinukeAutoRecovery";
import logger from "../../utils/logger";

export default class AntiNukeMemberRoleUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberUpdate",
      once: false,
    });
  }

  public async run(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));

    // Ignore profile-only updates and only react on role give/remove changes.
    if (addedRoles.size === 0 && removedRoles.size === 0) return;

    // Fast-path: skip entirely if not premium — avoids expensive audit log fetch for non-premium guilds
    const { isGuildPremiumActive } = require("../../../utils/premiumGuard");
    if (!await isGuildPremiumActive(newMember.guild.id)) return;

    // ── Recovery-in-progress guard ─────────────────────────────────────────
    // When the bot restores roles via roles.set(), Discord fires a new
    // guildMemberUpdate event. Without this guard, the listener would find
    // the original attacker's still-recent audit entry and re-trigger
    // recovery, causing a remove→add loop.
    if (isRecoveryInProgress(newMember.guild.id, newMember.id)) {
      logger.debug(
        `[ ANTINUKE ] Skipping memberRoleUpdate for ${newMember.user.tag} — recovery in progress.`,
      );
      return;
    }

    // ── Onboarding / Membership Screening bypass ───────────────────────────
    // Discord auto-assigns roles when a member completes onboarding or passes
    // membership screening. These are NOT malicious actions — skip AntiNuke.
    const justCompletedScreening = oldMember.pending === true && newMember.pending === false;
    const justCompletedOnboarding =
      !oldMember.flags.has(GuildMemberFlags.CompletedOnboarding) &&
      newMember.flags.has(GuildMemberFlags.CompletedOnboarding);

    if (justCompletedScreening || justCompletedOnboarding) {
      logger.debug(
        `[ ANTINUKE ] Ignoring onboarding/screening role assignment for ${newMember.user.tag} in ${newMember.guild.id}`,
      );
      return;
    }

    // Resolve executor early when available to avoid a second audit lookup.
    // Uses the shared cached audit log fetch from antinukeAutoRecovery.ts
    // to deduplicate API calls during burst attacks (50 events → ~1 fetch per 5s).
    try {
      const auditEntries = await getCachedMemberRoleAuditLogs(newMember.guild);

      if (auditEntries.length > 0) {
        const recentEntry = auditEntries.find(
          (e) => Date.now() - e.createdTimestamp < 8_000 && e.targetId === newMember.id,
        );

        if (recentEntry) {
          // ── Bot self-action check ──────────────────────────────────────
          // If the audit entry reason contains [ANTINUKE], the bot itself
          // made this change as part of recovery — skip to avoid loops.
          // Note: getCachedMemberRoleAuditLogs doesn't include reason,
          // but the executorId check below covers the bot-self case.

          const executorId = recentEntry.executorId;
          if (executorId) {
            // Skip self-role assignments (onboarding / Channels & Roles)
            if (executorId === newMember.id) {
              logger.debug(`[ ANTINUKE ] Ignoring self-role assignment (likely onboarding) for ${newMember.user.tag}`);
              return;
            }

            // Skip if executor is the bot itself
            if (executorId === this.client.user?.id) {
              logger.debug(`[ ANTINUKE ] Skipping memberRoleUpdate — executor is bot itself.`);
              return;
            }

            const addedText = addedRoles.map((role) => role.name).slice(0, 3).join(", ");
            const removedText = removedRoles.map((role) => role.name).slice(0, 3).join(", ");
            const context = `memberRoleUpdate:${newMember.user.tag}:+${addedText || "none"}:-${removedText || "none"}`;
            const protection = await runAntiNukeProtectionDetailed(this.client, newMember.guild, "memberRoleUpdate", context, {
              executorId,
              targetId: newMember.id,
            });

            if (protection.enforced) {
              const autoRecovery = await isAutoRecoveryEnabled(newMember.guild.id);
              if (autoRecovery) {
                const restored = await restoreMemberRoles(oldMember, newMember);
                if (restored) {
                  await sendRecoveryReport(
                    newMember.guild,
                    "Member Role Update Revert",
                    `Reverted unauthorized role changes for <@${newMember.id}> (\`${newMember.user.tag}\`)`,
                  );
                }
              }
            }

            return;
          }
        }
      }
    } catch (err) {
      logger.debug(`[ ANTINUKE ] memberRoleUpdate audit pre-check failed: ${err}`);
    }

    const addedText = addedRoles.map((role) => role.name).slice(0, 3).join(", ");
    const removedText = removedRoles.map((role) => role.name).slice(0, 3).join(", ");
    const context = `memberRoleUpdate:${newMember.user.tag}:+${addedText || "none"}:-${removedText || "none"}`;

    const protection = await runAntiNukeProtectionDetailed(this.client, newMember.guild, "memberRoleUpdate", context, {
      targetId: newMember.id,
    });

    if (protection.enforced) {
      const autoRecovery = await isAutoRecoveryEnabled(newMember.guild.id);
      if (autoRecovery) {
        const restored = await restoreMemberRoles(oldMember, newMember);
        if (restored) {
          await sendRecoveryReport(
            newMember.guild,
            "Member Role Update Revert",
            `Reverted unauthorized role changes for <@${newMember.id}> (\`${newMember.user.tag}\`)`,
          );
        }
      }
    }
  }
}

