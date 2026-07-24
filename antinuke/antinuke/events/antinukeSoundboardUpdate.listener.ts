import { SoundboardSound, AuditLogEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeSoundboardUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "soundboardSoundUpdate",
      once: false,
    });
  }

  public async run(oldSound: SoundboardSound, newSound: SoundboardSound): Promise<void> {
    if (!newSound.guildId) return;

    const guild = newSound.guild
      || this.client.guilds.cache.get(newSound.guildId)
      || await this.client.guilds.fetch(newSound.guildId).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(this.client, guild, "soundboardUpdate", `soundboardUpdate:${oldSound.name}->${newSound.name}`, {
      auditType: AuditLogEvent.SoundboardSoundUpdate,
    });
  }
}
