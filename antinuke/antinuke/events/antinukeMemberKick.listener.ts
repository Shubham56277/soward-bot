import { GuildMember } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";
import { isGuildPremiumActive } from "../../utils/premiumGuard";

export default class AntiNukeMemberKickListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberRemove",
      once: false,
    });
  }

  public async run(member: GuildMember): Promise<void> {
    // Fast-path: skip entirely if not premium — avoids audit log fetch + 800ms retry for non-premium guilds
    if (!await isGuildPremiumActive(member.guild.id)) return;

    // Check if this looks like a kick by inspecting the audit log cache first.
    // If no recent MemberKick audit entry exists, skip entirely to avoid the 800ms retry penalty.
    await runAntiNukeProtection(this.client, member.guild, "memberKick", `memberKick:${member.user.tag}`);
  }
}
