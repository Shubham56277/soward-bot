import { SoundboardSound, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeSoundboardDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "soundboardSoundDelete",
      once: false,
    });
  }

  public async run(sound: SoundboardSound): Promise<void> {
    if (!sound.guildId) return;

    const guild = sound.guild
      || this.client.guilds.cache.get(sound.guildId)
      || await this.client.guilds.fetch(sound.guildId).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(this.client, guild, "soundboardDelete", `soundboardDelete:${sound.name}`, {
      auditType: AuditLogEvent.SoundboardSoundDelete,
    });
  }
}
