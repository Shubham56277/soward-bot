import { AuditLogEvent, Guild, Invite } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeInviteDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "inviteDelete",
      once: false,
    });
  }

  public async run(invite: Invite): Promise<void> {
    if (!invite.guild) return;

    // invite.guild can be Guild | InviteGuild — resolve to a full Guild
    const guild = this.client.guilds.cache.get(invite.guild.id)
      || await this.client.guilds.fetch(invite.guild.id).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(
      this.client,
      guild,
      "guildUpdate",
      `inviteDelete:${invite.code}`,
      { auditType: AuditLogEvent.InviteDelete },
    );
  }
}

