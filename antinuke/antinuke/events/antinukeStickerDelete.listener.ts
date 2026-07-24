import { Sticker, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, recoverDeletedSticker, sendRecoveryReport } from "../modules/antinukeAutoRecovery";

export default class AntiNukeStickerDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "stickerDelete",
      once: false,
    });
  }

  public async run(sticker: Sticker): Promise<void> {
    if (!sticker.guildId) return;

    const guild = sticker.guild
      || this.client.guilds.cache.get(sticker.guildId)
      || await this.client.guilds.fetch(sticker.guildId).catch(() => null);
    if (!guild) return;

    const protection = await runAntiNukeProtectionDetailed(this.client, guild, "emojiStickerDelete", `stickerDelete:${sticker.name}`, {
       auditType: AuditLogEvent.StickerDelete,
    });

    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(guild.id);
    if (!autoRecoveryEnabled) return;

    const recovered = await recoverDeletedSticker(sticker);
    if (!recovered) return;

    await sendRecoveryReport(guild, "Sticker Restored", `Recovered deleted sticker: **${sticker.name}**`);
  }
}
