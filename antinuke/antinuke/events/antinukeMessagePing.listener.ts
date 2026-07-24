import { Message, PermissionFlagsBits } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection, evaluateAntiNukeAction } from "../client/antinukeRuntime";
import logger from "../../utils/logger";

const MESSAGE_FETCH_COOLDOWN_MS = 8_000;
const CHANNEL_HIDE_COOLDOWN_MS = 10_000;
const WEBHOOK_FETCH_COOLDOWN_MS = 5_000;

const messageCleanupCooldown = new Map<string, number>();
const channelHideCooldown = new Map<string, number>();
const webhookFetchCooldown = new Map<string, number>();

function shouldRunWithCooldown(cooldownMap: Map<string, number>, key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const expiresAt = cooldownMap.get(key) || 0;
  if (now < expiresAt) return false;
  cooldownMap.set(key, now + cooldownMs);
  return true;
}

export default class AntiNukeMessagePingListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "messageCreate",
      once: false,
    });
  }

  public async run(message: Message): Promise<void> {
    if (!message.guild || !message.guildId || !message.member) return;
    if (message.author.id === this.client.user?.id) return;

    // ── @everyone / @here ping ──────────────────────────────────────────────
    if (message.mentions.everyone) {
      // Webhook-based @everyone ping — special handling
      if (message.webhookId) {
        await this.handleWebhookEveryonePing(message);
        return;
      }

      if (message.author.bot) return;

      const triggered = await runAntiNukeProtection(
        this.client,
        message.guild,
        "everyoneHerePing",
        `everyoneHerePing:${message.id}`,
        { executorId: message.author.id },
      );

      if (triggered) {
        await this.cleanupEveryoneMessages(message);
      }
      return;
    }

    // ── Role ping ───────────────────────────────────────────────────────────
    if (message.mentions.roles.size > 0) {
      if (message.author.bot || message.webhookId) return;

      let isMainRolePinged = false;

      const dangerousPerms = [
          PermissionFlagsBits.Administrator,
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageWebhooks
      ];

      for (const role of message.mentions.roles.values()) {
        if (dangerousPerms.some(p => role.permissions.has(p))) {
          isMainRolePinged = true;
          break;
        }
      }

      if (!isMainRolePinged) return;

      const triggered = await runAntiNukeProtection(
        this.client,
        message.guild,
        "rolePing",
        `rolePing:${message.id}`,
        { executorId: message.author.id },
      );

      if (triggered) {
        // Delete the offending message
        await message.delete().catch(() => null);
      }
    }
  }

  /**
   * Handle @everyone/@here pings from webhooks:
   * 1. Delete the message
   * 2. Hide the channel from @everyone role
   * 3. Delete the webhook
   */
  private async handleWebhookEveryonePing(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      // Check if this action should be enforced (use evaluation to check config/whitelist)
      const evaluation = await evaluateAntiNukeAction(
        this.client,
        message.guild,
        "everyoneHerePing",
        { executorId: message.author.id },
      );

      if (!evaluation.shouldEnforce) return;

      // 1. Delete the offending message
      await message.delete().catch(() => null);

      // 2. Hide channel from @everyone
      const everyoneOverwrite = message.channel.isTextBased() && "permissionOverwrites" in message.channel
        ? message.channel.permissionOverwrites.resolve(message.guild.id)
        : null;

      const hideCooldownKey = `${message.guild.id}:${message.channelId}`;
      const canAttemptHide = shouldRunWithCooldown(channelHideCooldown, hideCooldownKey, CHANNEL_HIDE_COOLDOWN_MS);
      if (canAttemptHide && (!everyoneOverwrite || everyoneOverwrite.allow.has(PermissionFlagsBits.ViewChannel))) {
        if ("permissionOverwrites" in message.channel) {
          await message.channel.permissionOverwrites.edit(message.guild.id, {
            ViewChannel: false,
          }, {
            reason: `[ANTINUKE] Anti Everyone | Webhook ping by ${message.author.tag}`,
          }).catch(() => null);
        }
      }

      // 3. Find and delete the webhook
      if (message.webhookId) {
        try {
          const webhookCooldownKey = message.guild.id;
          const canFetchWebhooks = shouldRunWithCooldown(webhookFetchCooldown, webhookCooldownKey, WEBHOOK_FETCH_COOLDOWN_MS);
          if (canFetchWebhooks) {
            const webhooks = await message.guild.fetchWebhooks().catch(() => null);
            if (webhooks) {
              const webhook = webhooks.get(message.webhookId);
              if (webhook) {
                await webhook.delete("[ANTINUKE] Deleted for mentioning @everyone/@here").catch(() => null);
              }
            }
          }
        } catch {
          // Ignore webhook cleanup failures
        }
      }

      logger.info(`[ ANTINUKE ] Cleaned up webhook @everyone ping in ${message.guild.id}, channel ${message.channelId}`);
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Webhook @everyone cleanup failed: ${err}`);
    }
  }

  /**
   * Cleanup @everyone messages:
   * 1. Delete the offending message(s)
   * 2. Hide the channel from @everyone role
   */
  private async cleanupEveryoneMessages(message: Message): Promise<void> {
    if (!message.guild) return;

    try {
      const cleanupCooldownKey = `${message.guild.id}:${message.channelId}`;
      if (!shouldRunWithCooldown(messageCleanupCooldown, cleanupCooldownKey, MESSAGE_FETCH_COOLDOWN_MS)) {
        return;
      }

      // Delete recent @everyone messages in the channel
      const recentMessages = await message.channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (recentMessages) {
        const everyoneMessages = recentMessages.filter((msg) => msg.mentions.everyone);
        if (everyoneMessages.size === 1) {
          await everyoneMessages.first()?.delete().catch(() => null);
        } else if (everyoneMessages.size > 1 && "bulkDelete" in message.channel) {
          await (message.channel as any).bulkDelete(everyoneMessages).catch(() => null);
        }
      }

      // Hide channel from @everyone
      if ("permissionOverwrites" in message.channel) {
        const everyoneOverwrite = message.channel.permissionOverwrites.resolve(message.guild.id);
        const hideCooldownKey = `${message.guild.id}:${message.channelId}`;
        const canAttemptHide = shouldRunWithCooldown(channelHideCooldown, hideCooldownKey, CHANNEL_HIDE_COOLDOWN_MS);
        if (canAttemptHide && (!everyoneOverwrite || everyoneOverwrite.allow.has(PermissionFlagsBits.ViewChannel))) {
          await message.channel.permissionOverwrites.edit(message.guild.id, {
            ViewChannel: false,
          }, {
            reason: `[ANTINUKE] Anti Everyone | Mentioned by ${message.author.tag} (${message.author.id})`,
          }).catch(() => null);
        }
      }
    } catch (err) {
      logger.debug(`[ ANTINUKE ] @everyone cleanup failed: ${err}`);
    }
  }
}
