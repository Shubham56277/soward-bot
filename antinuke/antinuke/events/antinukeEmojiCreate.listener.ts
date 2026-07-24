import { GuildEmoji } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedEmoji, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeEmojiCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "emojiCreate",
      once: false,
    });
  }

  public async run(emoji: GuildEmoji): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(this.client, emoji.guild, "emojiStickerCreate", `emojiCreate:${emoji.name}`);
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(emoji.guild.id);
    if (!autoRecoveryEnabled) return;

    const cleaned = await cleanupUnauthorizedEmoji(emoji);
    if (!cleaned) return;

    await sendRecoveryReport(emoji.guild, "Unauthorized Emoji Removed", `Cleaned up unauthorized emoji: **:${emoji.name}:**`);
  }
}
