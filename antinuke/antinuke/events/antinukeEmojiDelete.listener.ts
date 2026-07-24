import { GuildEmoji } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, recoverDeletedEmoji, sendRecoveryReport } from "../modules/antinukeAutoRecovery";

export default class AntiNukeEmojiDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "emojiDelete",
      once: false,
    });
  }

  public async run(emoji: GuildEmoji): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(this.client, emoji.guild, "emojiStickerDelete", `emojiDelete:${emoji.name}`);
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(emoji.guild.id);
    if (!autoRecoveryEnabled) return;

    const recovered = await recoverDeletedEmoji(emoji);
    if (!recovered) return;

    await sendRecoveryReport(emoji.guild, "Emoji Restored", `Recovered deleted emoji: **:${emoji.name}:**`);
  }
}
