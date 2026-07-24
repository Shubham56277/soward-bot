import { GuildEmoji } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeEmojiUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "emojiUpdate",
      once: false,
    });
  }

  public async run(oldEmoji: GuildEmoji, newEmoji: GuildEmoji): Promise<void> {
    await runAntiNukeProtection(
      this.client,
      newEmoji.guild,
      "emojiStickerUpdate",
      `emojiUpdate:${oldEmoji.name}->${newEmoji.name}`,
    );
  }
}
