import { AutoModerationRule } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtection } from "../client/antinukeRuntime";

export default class AntiNukeAutomodUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "autoModerationRuleUpdate",
      once: false,
    });
  }

  public async run(_oldRule: AutoModerationRule | null, newRule: AutoModerationRule): Promise<void> {
    await runAntiNukeProtection(this.client, newRule.guild, "autoModerationRuleUpdate", `automodUpdate:${newRule.name}`);
  }
}
