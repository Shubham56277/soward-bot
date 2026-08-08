import { GuildMember } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeMemberKickListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberRemove",
      once: false,
    });
  }

  public async run(member: GuildMember): Promise<void> {
    // Emergency Mass Member Protection runs regardless of premium status.
    // The premium check is handled inside evaluateAntiNukeAction for normal enforcement.
    await runAntiNukeProtection(this.client, member.guild, "memberKick", `memberKick:${member.user.tag}`);
  }
}
