import { AutoModerationRule } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeAutomodCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "autoModerationRuleCreate",
      once: false,
    });
  }

  public async run(rule: AutoModerationRule): Promise<void> {
    await runAntiNukeProtection(this.client, rule.guild, "autoModerationRuleCreate", `automodCreate:${rule.name}`);
  }
}
