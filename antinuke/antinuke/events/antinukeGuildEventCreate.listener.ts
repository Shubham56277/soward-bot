import { GuildScheduledEvent } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeGuildEventCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildScheduledEventCreate",
      once: false,
    });
  }

  public async run(event: GuildScheduledEvent): Promise<void> {
    const guild = event.guild
      || this.client.guilds.cache.get(event.guildId)
      || await this.client.guilds.fetch(event.guildId).catch(() => null);
    if (!guild) return;

    await runAntiNukeProtection(this.client, guild, "guildScheduledEventCreate", `guildEventCreate:${event.name}`);
  }
}
