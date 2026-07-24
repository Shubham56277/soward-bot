import { Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { addAntiNukeAudit, getAntiNukeConfig, type AntiNukeConfig } from "../client/antinukeStore";
import { sendIncidentLog } from "../client/antinukeRuntime";
import { isGuildPremiumActive } from "../../utils/premiumGuard";
import { queueRoleModification } from "../../utils/roleQueue";
import logger from "../../utils/logger";

/** Same surface as invite-role abuse: high-impact moderation permissions. */
const DANGEROUS_JOIN_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
];

/** Let Discord apply invite-linked roles before the first read (reduces false negatives). */
const INITIAL_JOIN_WAIT_MS = 1_200;

/**
 * Join handlers with lower priority (AutoRole, roleQueue rewards, delayed Discord grants)
 * can re-apply risky roles AFTER our first strip. Sweeps enqueue removes so they serialize
 * with other PATCH traffic and pick up roles that appeared again later.
 */
const FOLLOW_UP_SWEEP_DELAYS_MS = [3_000, 7_500, 16_000];

const REMOVE_REASON =
  "[ANTINUKE] Dangerous Permission on Join — removing risky role grants";

export default class AntiNukeDangerousJoinListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberAdd",
      once: false,
    });
  }

  public async run(member: GuildMember): Promise<void> {
    if (member.user.bot) return;

    const guild = member.guild;
    const guildId = guild.id;

    try {
      const premiumActive = await isGuildPremiumActive(guildId);
      if (!premiumActive) return;

      const config = await getAntiNukeConfig(guildId);
      if (!config?.enabled) return;

      const moduleEnabled = config.moduleStates?.antiInviteRole !== false;
      if (!moduleEnabled) return;

      await new Promise((r) => setTimeout(r, INITIAL_JOIN_WAIT_MS));

      let fresh = await member.fetch().catch(() => member);

      const firstContext = await this.evaluateDangerousJoinContext(guild, fresh, config);
      if (!firstContext) return;

      const { dangerousOnMember, removable, userId } = firstContext;

      if (firstContext.whitelistedBypass) {
        await sendIncidentLog(
          guild,
          config.logChannelId,
          "⚠️ Dangerous Permission on Join (Allowed)",
          [
            `**Member:** <@${userId}> (\`${userId}\`)`,
            `**Roles with risky permissions:** ${this.formatRoleList(dangerousOnMember)}`,
            "",
            `> Allowed because the member is ${firstContext.bypassReason}.`,
          ].join("\n"),
          { executorId: userId, isNearMiss: true },
        ).catch(() => null);
        return;
      }

      const botMember =
        guild.members.me || (await guild.members.fetchMe().catch(() => null));
      if (!botMember) return;

      const removableFiltered = removable.filter(
        (role) =>
          role.position < botMember.roles.highest.position,
      );

      // First strike: synchronous remove completes before priority-50 join handlers queue adds.
      if (removableFiltered.size > 0 && fresh.manageable) {
        await fresh.roles.remove(removableFiltered, REMOVE_REASON).catch(() => null);
      }

      const couldNotStrip = [...dangerousOnMember.values()].filter((r) => !removableFiltered.has(r.id));

      await addAntiNukeAudit(guild.id, userId, "dangerousPermissionOnJoin", {
        type: "dangerous_join_role",
        removedRoleIds: [...removableFiltered.keys()],
        dangerousRoles: [...dangerousOnMember.values()].map((r) => ({
          id: r.id,
          name: r.name,
          permissions: r.permissions.bitfield.toString(),
        })),
        punishment: null,
        onlyRoleRemoval: true,
        unremovedDangerousRoles: couldNotStrip.map((r) => ({ id: r.id, name: r.name })),
      }).catch(() => null);

      await this.emitStripLog(guild, config, fresh.id, removableFiltered, couldNotStrip);

      this.scheduleFollowUpSweeps(this.client, guildId, fresh.id);

      logger.warn(`[ ANTINUKE ] Dangerous join: stripped risky roles for ${userId} in ${guildId}`);
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Dangerous join listener error in ${guildId}: ${err}`);
    }
  }

  private scheduleFollowUpSweeps(client: Bot, guildId: string, userId: string): void {
    for (const delay of FOLLOW_UP_SWEEP_DELAYS_MS) {
      setTimeout(() => {
        void this.runFollowUpSweep(client, guildId, userId);
      }, delay);
    }
  }

  private async runFollowUpSweep(client: Bot, guildId: string, userId: string): Promise<void> {
    try {
      const premiumActive = await isGuildPremiumActive(guildId);
      if (!premiumActive) return;

      const config = await getAntiNukeConfig(guildId);
      if (!config?.enabled || config.moduleStates?.antiInviteRole === false) return;

      const guild =
        client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      if (!guild) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member?.user || member.user.bot) return;

      const ctx = await this.evaluateDangerousJoinContext(guild, member, config);
      if (!ctx || ctx.whitelistedBypass) return;

      const botMember =
        guild.members.me || (await guild.members.fetchMe().catch(() => null));
      if (!botMember) return;

      const removableFiltered = ctx.removable.filter(
        (role) => role.position < botMember.roles.highest.position,
      );
      if (removableFiltered.size === 0 || !member.manageable) return;

      queueRoleModification(
        member,
        [...removableFiltered.values()],
        "remove",
        `${REMOVE_REASON} (follow-up sweep)`,
      );

      await sendIncidentLog(
        guild,
        config.logChannelId,
        "Dangerous Permission on Join — follow-up sweep",
        [
          "**01** — **Dangerous Permission on Join** (follow-up)",
          `**02** — Re-issued **remove** for roles that appeared again after the join strip (Discord grant delay, AutoRole queue, integrations, etc.).`,
          `**03** — **Roles:** ${this.formatRoleList(removableFiltered)}`,
          `**Member:** <@${userId}> (\`${userId}\`)`,
        ].join("\n"),
        { executorId: userId, threshold: 0 },
      ).catch(() => null);

      logger.warn(
        `[ ANTINUKE ] Dangerous join sweep: queued remove again for ${userId} in ${guildId}`,
      );
    } catch (err) {
      logger.debug(`[ ANTINUKE ] Dangerous join sweep error ${guildId}/${userId}: ${err}`);
    }
  }

  private async evaluateDangerousJoinContext(
    guild: Guild,
    fresh: GuildMember,
    config: AntiNukeConfig,
  ): Promise<
    | {
        userId: string;
        dangerousOnMember: GuildMember["roles"]["cache"];
        removable: GuildMember["roles"]["cache"];
        whitelistedBypass: boolean;
        bypassReason: string;
      }
    | null
  > {
    const dangerousOnMember = fresh.roles.cache.filter((role) =>
      DANGEROUS_JOIN_ROLE_PERMISSIONS.some((perm) => role.permissions.has(perm)),
    );
    if (dangerousOnMember.size === 0) return null;

    const userId = fresh.id;
    const isOwner = userId === guild.ownerId;
    const isExtraOwner =
      Array.isArray(config.extraOwnerIds) && config.extraOwnerIds.includes(userId);
    const isBotSelf = userId === this.client.user?.id;

    const whitelistAction = "linkRole";
    const profile = config.whitelistAccess?.[userId];
    const isWhitelistedUser =
      Boolean(profile?.fullAccess) ||
      Boolean(
        profile &&
          Array.isArray(profile.actions) &&
          profile.actions.includes(whitelistAction as never),
      ) ||
      (Array.isArray(config.whitelistUserIds) && config.whitelistUserIds.includes(userId));

    const hasLegacyWhitelistedRole = Boolean(
      Array.isArray(config.whitelistRoleIds) &&
        config.whitelistRoleIds.some((roleId) => fresh.roles.cache.has(roleId)),
    );
    const hasProfileWhitelistedRole = Boolean(
      config.whitelistRoleAccess &&
        Object.entries(config.whitelistRoleAccess).some(([roleId, roleProfile]) => {
          if (!fresh.roles.cache.has(roleId)) return false;
          if (!roleProfile || typeof roleProfile !== "object") return false;
          const full = Boolean((roleProfile as { fullAccess?: boolean }).fullAccess);
          const actions: string[] = Array.isArray((roleProfile as { actions?: string[] }).actions)
            ? (roleProfile as { actions: string[] }).actions
            : [];
          return full || actions.includes(whitelistAction);
        }),
    );
    const isWhitelistedRole = hasLegacyWhitelistedRole || hasProfileWhitelistedRole;
    const isWhitelisted = isWhitelistedUser || isWhitelistedRole;

    const whitelistedBypass = isOwner || isExtraOwner || isBotSelf || isWhitelisted;
    const bypassReason = isOwner
      ? "the **server owner**"
      : isExtraOwner
        ? "an **extra owner**"
        : "**whitelisted**";

    const removable = dangerousOnMember.filter(
      (role) =>
        role.id !== guild.id && !role.managed,
    );

    return {
      userId,
      dangerousOnMember,
      removable,
      whitelistedBypass,
      bypassReason,
    };
  }

  private async emitStripLog(
    guild: Guild,
    config: AntiNukeConfig,
    userId: string,
    removableFiltered: GuildMember["roles"]["cache"],
    couldNotStrip: Role[],
  ): Promise<void> {
    const stripNote =
      removableFiltered.size > 0
        ? `Removed **${removableFiltered.size}** dangerous role grant(s): ${this.formatRoleList(removableFiltered)}`
        : "Could not remove any dangerous roles (managed, hierarchy, or permissions).";

    await sendIncidentLog(
      guild,
      config.logChannelId,
      "Dangerous Permission on Join",
      [
        "**01** — With reason **Dangerous Permission on Join**",
        `**02** — ${stripNote}`,
        "**03** — A few **automatic follow-up sweeps** will run to catch roles Discord or other bots re-applied shortly after join.",
        `**Member:** <@${userId}> (\`${userId}\`)`,
        couldNotStrip.length > 0
          ? [
              "",
              `**Not removable automatically:** ${couldNotStrip
                .map((r) => `**${r.name}** (\`${r.id}\`)`)
                .join(", ")}`,
            ].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      {
        executorId: userId,
        threshold: 0,
      },
    ).catch(() => null);

    if (config.notifyOwner) {
      try {
        const owner = await guild.fetchOwner();
        await owner
          .send({
            content: [
              "**AntiNuke — Dangerous Permission on Join**",
              "",
              `**Server:** ${guild.name}`,
              `**Member:** <@${userId}>`,
              stripNote,
              couldNotStrip.length > 0
                ? `\n**Not removable:** ${couldNotStrip.map((r) => r.name).join(", ")} — check bot role position / integrations.`
                : "",
              "\n*Follow-up sweeps will retry if risky roles return within ~16s.*",
            ].join("\n"),
          })
          .catch(() => null);
      } catch {
        /* ignore */
      }
    }
  }

  private formatRoleList(collection: GuildMember["roles"]["cache"]): string {
    return [...collection.values()]
      .map((r: Role) => `**${r.name}** (\`${r.id}\`)`)
      .join(", ");
  }
}
