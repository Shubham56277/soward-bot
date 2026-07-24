import { Sticker, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedSticker, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeStickerCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "stickerCreate",
      once: false,
    });
  }

  public async run(sticker: Sticker): Promise<void> {
    if (!sticker.guildId) return;

    const guild = sticker.guild
      || this.client.guilds.cache.get(sticker.guildId)
      || await this.client.guilds.fetch(sticker.guildId).catch(() => null);
    if (!guild) return;

    const protection = await runAntiNukeProtectionDetailed(this.client, guild, "emojiStickerCreate", `stickerCreate:${sticker.name}`, {
      auditType: AuditLogEvent.StickerCreate,
    });
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(guild.id);
    if (!autoRecoveryEnabled) return;

    const cleaned = await cleanupUnauthorizedSticker(sticker);
    if (!cleaned) return;

    await sendRecoveryReport(guild, "Unauthorized Sticker Removed", `Cleaned up unauthorized sticker: **${sticker.name}**`);
  }
}
