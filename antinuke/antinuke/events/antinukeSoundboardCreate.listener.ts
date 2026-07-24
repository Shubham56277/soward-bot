import { SoundboardSound, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedSoundboardSound, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeSoundboardCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "soundboardSoundCreate",
      once: false,
    });
  }

  public async run(sound: SoundboardSound): Promise<void> {
    if (!sound.guildId) return;

    const guild = sound.guild
      || this.client.guilds.cache.get(sound.guildId)
      || await this.client.guilds.fetch(sound.guildId).catch(() => null);
    if (!guild) return;

    const protection = await runAntiNukeProtectionDetailed(this.client, guild, "soundboardCreate", `soundboardCreate:${sound.name}`, {
      auditType: AuditLogEvent.SoundboardSoundCreate,
    });
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(guild.id);
    if (!autoRecoveryEnabled) return;

    const cleaned = await cleanupUnauthorizedSoundboardSound(sound);
    if (!cleaned) return;

    await sendRecoveryReport(guild, "Unauthorized Soundboard Sound Removed", `Cleaned up unauthorized sound: **${sound.name}**`);
  }
}
