import { Routes } from "discord-api-types/v10";
import { Guild, PermissionFlagsBits, WebhookClient } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { isAutoRecoveryEnabled, restoreUpdatedGuild, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { evaluateAntiNukeAction, runAntiNukeProtection, runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import logger from "../../utils/logger";
import { resolveWebhookUrl } from "../../utils/rootConfig";
import { LRUCache } from "lru-cache";

export default class AntiNukeGuildUpdateListener extends Event {
  private static readonly pendingVanityReleaseChecks = new LRUCache<string, Promise<void>>({
    max: 5_000,
    ttl: 6 * 60 * 60_000,
    ttlAutopurge: false,
    updateAgeOnGet: false,
  });
  private static readonly DEFAULT_INITIAL_DELAY_MS = 60_000;
  private static readonly DEFAULT_CHECK_INTERVAL_MS = 120_000;
  private static readonly DEFAULT_MAX_ATTEMPTS = 120;
  private static readonly DEFAULT_REQUIRED_INACTIVE_STREAK = 15;

  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildUpdate",
      once: false,
    });
  }

  public async run(oldGuild: Guild, newGuild: Guild): Promise<void> {
    const previousVanityCode = oldGuild.vanityURLCode ?? null;
    const nextVanityCode = newGuild.vanityURLCode ?? null;
    const vanityChanged = previousVanityCode !== nextVanityCode;

    if (vanityChanged) {
      const context = `vanityUpdate:${previousVanityCode || "none"}->${nextVanityCode || "none"}`;
      const evaluation = await evaluateAntiNukeAction(this.client, newGuild, "vanityUpdate");
      const autoRecoveryEnabled = await isAutoRecoveryEnabled(newGuild.id);

      if (evaluation.shouldEnforce && autoRecoveryEnabled) {
        await this.restoreVanityCode(newGuild, previousVanityCode, nextVanityCode);
      }

      if (evaluation.shouldEnforce) {
        await runAntiNukeProtection(this.client, newGuild, "vanityUpdate", context, {
          executorId: evaluation.executorId ?? undefined,
        });
      }

      if (previousVanityCode) {
        this.enqueueVanityReleaseCheck(newGuild.id, previousVanityCode, nextVanityCode);
      }

      return;
    }

    const context = `guildUpdate:${oldGuild.name}->${newGuild.name}`;
    const protection = await runAntiNukeProtectionDetailed(this.client, newGuild, "guildUpdate", context);
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(newGuild.id);
    if (!autoRecoveryEnabled) return;

    const restored = await restoreUpdatedGuild(oldGuild, newGuild);
    if (!restored) return;

    await sendRecoveryReport(newGuild, "Server Settings Reverted", `Restored guild settings for **${oldGuild.name}**`);
  }

  private enqueueVanityReleaseCheck(guildId: string, previousCode: string, nextCode: string | null): void {
    const normalizedCode = previousCode.trim().toLowerCase();
    if (!this.isValidVanityCode(normalizedCode)) return;

    const webhookUrl = resolveWebhookUrl("vanityRelease");
    if (!webhookUrl) return;

    if (AntiNukeGuildUpdateListener.pendingVanityReleaseChecks.has(normalizedCode)) {
      return;
    }

    const verificationTask = this.verifyAndNotifyVanityRelease(guildId, normalizedCode, nextCode, webhookUrl)
      .catch((error) => {
        logger.debug(`[ VANITY_RELEASE ] Verification failed for ${normalizedCode}: ${error}`);
      })
      .finally(() => {
        AntiNukeGuildUpdateListener.pendingVanityReleaseChecks.delete(normalizedCode);
      });

    AntiNukeGuildUpdateListener.pendingVanityReleaseChecks.set(normalizedCode, verificationTask);
  }

  private async verifyAndNotifyVanityRelease(
    guildId: string,
    releasedCode: string,
    nextCode: string | null,
    webhookUrl: string,
  ): Promise<void> {
    const initialDelayMs = this.readPositiveIntegerEnv(
      "VANITY_RELEASE_INITIAL_DELAY_MS",
      AntiNukeGuildUpdateListener.DEFAULT_INITIAL_DELAY_MS,
    );
    const checkIntervalMs = this.readPositiveIntegerEnv(
      "VANITY_RELEASE_CHECK_INTERVAL_MS",
      AntiNukeGuildUpdateListener.DEFAULT_CHECK_INTERVAL_MS,
    );
    const maxAttempts = this.readPositiveIntegerEnv(
      "VANITY_RELEASE_CHECK_ATTEMPTS",
      AntiNukeGuildUpdateListener.DEFAULT_MAX_ATTEMPTS,
    );
    const configuredStreak = this.readPositiveIntegerEnv(
      "VANITY_RELEASE_REQUIRED_STREAK",
      AntiNukeGuildUpdateListener.DEFAULT_REQUIRED_INACTIVE_STREAK,
    );
    const requiredInactiveStreak = Math.min(configuredStreak, maxAttempts);

    await this.sleep(initialDelayMs);

    let inactiveStreak = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const sourceGuild = await this.client.guilds.fetch(guildId).catch(() => null);
      const currentVanity = sourceGuild?.vanityURLCode?.toLowerCase() ?? null;

      if (currentVanity === releasedCode) {
        logger.info(
          `[ VANITY_RELEASE ] Cancelled for ${releasedCode}: source guild ${guildId} restored the same vanity.`,
        );
        return;
      }

      const inviteStatus = await this.getInviteStatus(releasedCode);
      if (inviteStatus === "active") {
        inactiveStreak = 0;
      } else if (inviteStatus === "inactive") {
        inactiveStreak += 1;
      }

      if (inactiveStreak >= requiredInactiveStreak) {
        await this.sendVanityReleaseNotification(webhookUrl, releasedCode, guildId, nextCode);
        return;
      }

      if (attempt < maxAttempts) {
        await this.sleep(checkIntervalMs);
      }
    }

    logger.info(`[ VANITY_RELEASE ] Gave up on ${releasedCode} after ${maxAttempts} checks (never fully confirmed).`);
  }

  private async getInviteStatus(code: string): Promise<"active" | "inactive" | "unknown"> {
    try {
      await this.client.rest.get(Routes.invite(code));
      return "active";
    } catch (error) {
      const apiErrorCode = this.extractApiErrorCode(error);

      if (apiErrorCode === 10006) {
        return "inactive";
      }

      if (apiErrorCode !== null) {
        logger.debug(`[ VANITY_RELEASE ] Invite check for ${code} returned Discord error code ${apiErrorCode}.`);
      } else {
        logger.debug(`[ VANITY_RELEASE ] Invite check for ${code} failed: ${error}`);
      }

      return "unknown";
    }
  }

  private async sendVanityReleaseNotification(
    webhookUrl: string,
    releasedCode: string,
    sourceGuildId: string,
    nextCode: string | null,
  ): Promise<void> {
    const hook = new WebhookClient({ url: webhookUrl });

    try {
      const sourceGuild = await this.client.guilds.fetch(sourceGuildId).catch(() => null);
      const sourceGuildName = sourceGuild?.name ?? "Unknown Guild";
      const nextDisplay = nextCode ? nextCode : "none";

      await hook.send({
        content: releasedCode,
        allowedMentions: { parse: [] },
      });

      logger.warn(
        `[ VANITY_RELEASE ] Sent released vanity ${releasedCode} from guild ${sourceGuildId} (${sourceGuildName}) to support webhook. Replacement: ${nextDisplay}.`,
      );
    } catch (error) {
      logger.warn(`[ VANITY_RELEASE ] Failed to send webhook notification for ${releasedCode}: ${error}`);
    } finally {
      hook.destroy();
    }
  }

  private extractApiErrorCode(error: unknown): number | null {
    const value = (error as { code?: unknown })?.code;
    if (typeof value === "number") return value;

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return null;
  }

  private readPositiveIntegerEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;

    const normalized = Math.floor(value);
    if (normalized <= 0) return fallback;

    return normalized;
  }

  private isValidVanityCode(code: string): boolean {
    return /^[a-z0-9-]{2,32}$/i.test(code);
  }

  private async sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async restoreVanityCode(guild: Guild, previousCode: string | null, currentCode: string | null): Promise<void> {
    if (previousCode === currentCode) return;

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      logger.warn(`[ ANTINUKE ] Could not restore vanity URL in ${guild.id}: missing ManageGuild permission.`);
      return;
    }

    try {
      await guild.client.rest.patch(Routes.guildVanityUrl(guild.id), {
        body: { code: previousCode },
        reason: "[ANTINUKE] Reverting unauthorized vanity URL update",
      });

      guild.vanityURLCode = previousCode;
      logger.warn(`[ ANTINUKE ] Restored vanity URL in ${guild.id} (${currentCode || "none"} -> ${previousCode || "none"}).`);
    } catch (error) {
      logger.warn(`[ ANTINUKE ] Vanity restore failed in ${guild.id}: ${error}`);
    }
  }
}
