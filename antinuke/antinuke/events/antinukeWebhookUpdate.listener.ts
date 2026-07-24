import { AuditLogEvent, GuildChannel } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedWebhook, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import logger from "../../utils/logger";

const WEBHOOK_RECOVERY_COOLDOWN_MS = 5_000;
const webhookRecoveryCooldown = new Map<string, number>();
const WEBHOOK_AUDIT_CACHE_TTL_MS = 5_000;
const webhookAuditCache = new Map<string, { fetchedAt: number; entries: any[] }>();
const pendingWebhookAuditFetches = new Map<string, Promise<any[]>>();

function shouldRunWebhookRecovery(guildId: string): boolean {
  const now = Date.now();
  const expiresAt = webhookRecoveryCooldown.get(guildId) || 0;
  if (now < expiresAt) return false;
  webhookRecoveryCooldown.set(guildId, now + WEBHOOK_RECOVERY_COOLDOWN_MS);
  return true;
}

async function getCachedWebhookCreateAuditEntries(guild: GuildChannel["guild"]): Promise<any[]> {
  const now = Date.now();
  const cached = webhookAuditCache.get(guild.id);
  if (cached && now - cached.fetchedAt < WEBHOOK_AUDIT_CACHE_TTL_MS) {
    return cached.entries;
  }

  const pending = pendingWebhookAuditFetches.get(guild.id);
  if (pending) return pending;

  const fetchPromise = (async () => {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.WebhookCreate,
      limit: 5,
    }).catch(() => null);
    const entries = auditLogs ? [...auditLogs.entries.values()] : [];
    webhookAuditCache.set(guild.id, { fetchedAt: Date.now(), entries });
    return entries;
  })();

  pendingWebhookAuditFetches.set(guild.id, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingWebhookAuditFetches.delete(guild.id);
  }
}

export default class AntiNukeWebhookUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "webhookUpdate",
      once: false,
    });
  }

  public async run(channel: GuildChannel): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(this.client, channel.guild, "webhookUpdate", `webhookUpdate:${channel.id}`, {
      auditTypes: [
        AuditLogEvent.WebhookCreate,
        AuditLogEvent.WebhookUpdate,
        AuditLogEvent.WebhookDelete,
      ],
    });

    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(channel.guild.id);
    if (!autoRecoveryEnabled) return;
    if (!shouldRunWebhookRecovery(channel.guild.id)) return;

    // Attempt to find and delete any unauthorized webhooks in this channel
    try {
      const auditEntries = await getCachedWebhookCreateAuditEntries(channel.guild);
      if (auditEntries.length > 0) {
        const cleanedTargetIds = new Set<string>();
        for (const entry of auditEntries) {
          if (Date.now() - entry.createdTimestamp > 15_000) continue;
          const targetId = entry.target?.id || (entry.target as any)?.id;
          if (!targetId) continue;
          if (cleanedTargetIds.has(targetId)) continue;

          const cleaned = await cleanupUnauthorizedWebhook(channel.guild, targetId);
          if (cleaned) {
            cleanedTargetIds.add(targetId);
            await sendRecoveryReport(
              channel.guild,
              "Unauthorized Webhook Removed",
              `Cleaned up unauthorized webhook in <#${channel.id}>`,
            );
          }
        }
      }
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Webhook auto-recovery cleanup failed: ${err}`);
    }
  }
}
