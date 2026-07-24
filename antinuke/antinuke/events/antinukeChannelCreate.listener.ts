import { Channel } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { cleanupUnauthorizedChannel, isAutoRecoveryEnabled, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeChannelCreateListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "channelCreate",
      once: false,
    });
  }

  public async run(channel: Channel): Promise<void> {
    if (!("guild" in channel)) return;

    const protection = await runAntiNukeProtectionDetailed(this.client, channel.guild, "channelCreate", `channelCreate:${(channel as any).name || channel.id}`);
    if (!protection.enforced) return;

    if (!("permissionOverwrites" in channel)) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(channel.guild.id);
    if (!autoRecoveryEnabled) return;

    const cleaned = await cleanupUnauthorizedChannel(channel as any);
    if (!cleaned) return;

    await sendRecoveryReport(channel.guild, "Unauthorized Channel Removed", `Cleaned up unauthorized channel: **${(channel as any).name || channel.id}**`);
  }
}
