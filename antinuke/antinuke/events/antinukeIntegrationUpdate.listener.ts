import { AuditLogEvent, Guild } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeIntegrationUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "guildIntegrationsUpdate",
      once: false,
    });
  }

  public async run(guild: Guild): Promise<void> {
    // Default integration update check
    await runAntiNukeProtection(this.client, guild, "integrationUpdate", `integrationUpdate:${guild.id}`, {
      auditTypes: [
        AuditLogEvent.IntegrationCreate,
        AuditLogEvent.IntegrationUpdate,
        AuditLogEvent.IntegrationDelete,
      ],
    });
  }
}
