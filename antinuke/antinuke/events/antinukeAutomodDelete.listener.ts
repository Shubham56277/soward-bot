import { AutoModerationRule } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";
import { isAutoRecoveryEnabled, recoverDeletedAutoModRule, sendRecoveryReport } from "../modules/antinukeAutoRecovery";

export default class AntiNukeAutomodDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "autoModerationRuleDelete",
      once: false,
    });
  }

  public async run(rule: AutoModerationRule): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(this.client, rule.guild, "autoModerationRuleDelete", `automodDelete:${rule.name}`);
    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(rule.guild.id);
    if (!autoRecoveryEnabled) return;

    const recovered = await recoverDeletedAutoModRule(rule);
    if (!recovered) return;

    await sendRecoveryReport(rule.guild, "AutoMod Rule Restored", `Recovered deleted AutoMod rule: **${rule.name}**`);
  }
}
