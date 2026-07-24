import { AuditLogEvent, Guild, PermissionFlagsBits, PermissionsBitField, GuildAuditLogsEntry } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { getAntiNukeConfig } from "../client/antinukeStore";
import logger from "../../utils/logger";

export default class AntiNukeAuditLogEntryListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildAuditLogEntryCreate",
      once: false,
    });
  }

  public async run(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    try {
      // We strictly want to monitor when the bot itself is targeted for addition / integration modification
      if (entry.action !== AuditLogEvent.BotAdd && entry.action !== AuditLogEvent.IntegrationCreate) return;
      if (entry.action === AuditLogEvent.BotAdd && entry.targetId !== this.client.user?.id) return;

      const executorId = entry.executorId;
      if (!executorId || executorId === this.client.user?.id) return;

      // Allow Discord 1.5 seconds to construct our integration managed role within their cache
      await new Promise((r) => setTimeout(r, 1500));
      await guild.roles.fetch();
      const botMember = await guild.members.fetchMe();
      
      const botRole = botMember.roles.cache.find(
        (r) => r.managed && r.tags?.botId === this.client.user?.id
      );

      // Apply AntiNuke verifications using standard configs
      const config = await getAntiNukeConfig(guild.id);
      const isGuildOwner = executorId === guild.ownerId;
      const isBotExtraOwner = Array.isArray(config?.extraOwnerIds) && config?.extraOwnerIds.includes(executorId);
      const whitelistAction = entry.action === AuditLogEvent.BotAdd ? "botAdd" : "integrationUpdate";
      const userProfile = config?.whitelistAccess?.[executorId];
      const isWhitelistedUser =
        Boolean(config?.whitelistUserIds?.includes(executorId))
        || Boolean(userProfile?.fullAccess)
        || Boolean(userProfile && Array.isArray(userProfile.actions) && userProfile.actions.includes(whitelistAction as any));
      const executorMember = await guild.members.fetch(executorId).catch(() => null);
      const isWhitelistedRole = Boolean(
        executorMember
        && config?.whitelistRoleAccess
        && Object.entries(config.whitelistRoleAccess).some(([roleId, roleProfile]) => {
          if (!executorMember.roles.cache.has(roleId)) return false;
          if (!roleProfile || typeof roleProfile !== "object") return false;
          const full = Boolean((roleProfile as any).fullAccess);
          const actions = Array.isArray((roleProfile as any).actions) ? (roleProfile as any).actions : [];
          return full || actions.includes(whitelistAction);
        }),
      );

      if (!isGuildOwner && !isBotExtraOwner && !isWhitelistedUser && !isWhitelistedRole) {
        // Punish unauthorized user immediately — Discord permissions do not matter in AntiNuke
        await guild.members.ban(executorId, { reason: "Integration Create | Unauthorized User" }).catch(() => null);
        logger.info(`[ ANTINUKE ] Prevented and punished bot re-add bypass by ${executorId} in ${guild.id}`);
      }

      // Reinforce the Rimuru Unbreakable Core permissions
      if (botRole && !botRole.permissions.has(PermissionFlagsBits.Administrator)) {
        await botRole.setPermissions(
          new PermissionsBitField(botRole.permissions).add(PermissionFlagsBits.Administrator),
          "you can't bypass me newgen kid'z ? Better Luck Next time Kidz"
        ).catch(() => null);
      }
    } catch (err) {
      logger.error(`[ ANTINUKE ] Audit log entry bypass protection checks failed: ${err}`);
    }
  }
}
