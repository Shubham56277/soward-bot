import { AuditLogEvent, GuildMember } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";
import { isGuildPremiumActive } from "../../utils/premiumGuard";

export default class AntiNukeMemberPruneListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberRemove",
      once: false,
    });
  }

  public async run(member: GuildMember): Promise<void> {
    if (!await isGuildPremiumActive(member.guild.id)) return;

    await runAntiNukeProtection(this.client, member.guild, "memberPrune", `memberPrune:${member.user.tag}`, {
      auditType: AuditLogEvent.MemberPrune,
    });
  }
}
