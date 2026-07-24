import { Sticker, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeStickerUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "stickerUpdate",
      once: false,
    });
  }

  public async run(oldSticker: Sticker, newSticker: Sticker): Promise<void> {
    if (!newSticker.guildId) return;

    const guild = newSticker.guild
      || this.client.guilds.cache.get(newSticker.guildId)
      || await this.client.guilds.fetch(newSticker.guildId).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(this.client, guild, "emojiStickerUpdate", `stickerUpdate:${oldSticker.name}->${newSticker.name}`, {
      auditType: AuditLogEvent.StickerUpdate,
    });
  }
}
