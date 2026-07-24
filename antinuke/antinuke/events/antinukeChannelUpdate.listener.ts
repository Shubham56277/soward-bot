import { GuildChannel } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { isAutoRecoveryEnabled, restoreUpdatedChannel, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeChannelUpdateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "channelUpdate",
      once: false,
    });
  }

  public async run(oldChannel: GuildChannel, newChannel: GuildChannel): Promise<void> {
    const protection = await runAntiNukeProtectionDetailed(
      this.client,
      newChannel.guild,
      "channelUpdate",
      `channelUpdate:${oldChannel.name || oldChannel.id}->${newChannel.name || newChannel.id}`,
    );

    if (!protection.enforced) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(newChannel.guild.id);
    if (!autoRecoveryEnabled) return;

    const recovered = await restoreUpdatedChannel(oldChannel, newChannel);
    if (!recovered) return;

    await sendRecoveryReport(newChannel.guild, "Channel Reverted", `Restored channel: **${oldChannel.name || oldChannel.id}**`);
  }
}
