import { GuildMember } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runGen3MemberDisplayEnforcement } from "../modules/antinukeGen3";

/**
 * AntiNuke 3rd Gen — re-scan username filter when server nickname changes (post-join).
 */
export default class AntiNukeGen3MemberUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildMemberUpdate",
      once: false,
    });
  }

  public async run(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    await runGen3MemberDisplayEnforcement(this.client, oldMember, newMember);
  }
}
