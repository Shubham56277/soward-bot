import { GuildScheduledEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeGuildEventUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildScheduledEventUpdate",
      once: false,
    });
  }

  public async run(_oldEvent: GuildScheduledEvent | null, newEvent: GuildScheduledEvent): Promise<void> {
    const guild = newEvent.guild
      || this.client.guilds.cache.get(newEvent.guildId)
      || await this.client.guilds.fetch(newEvent.guildId).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(this.client, guild, "guildScheduledEventUpdate", `guildEventUpdate:${newEvent.name}`);
  }
}
