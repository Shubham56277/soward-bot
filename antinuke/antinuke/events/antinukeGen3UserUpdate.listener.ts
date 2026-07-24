import { User } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runGen3UserProfileEnforcement } from "../modules/antinukeGen3";

/**
 * AntiNuke 3rd Gen — re-scan username filter when a member's global profile name changes.
 */
export default class AntiNukeGen3UserUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "userUpdate",
      once: false,
    });
  }

  public async run(oldUser: User, newUser: User): Promise<void> {
    await runGen3UserProfileEnforcement(this.client, oldUser, newUser);
  }
}
