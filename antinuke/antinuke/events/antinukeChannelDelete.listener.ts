import { Channel } from "discord.js";
import { Bot } from "../../core/client";
import { Event } from "../../tools/events";
import { isAutoRecoveryEnabled, recoverDeletedChannel, sendRecoveryReport } from "../modules/antinukeAutoRecovery";
import { runAntiNukeProtectionDetailed } from "../client/antinukeRuntime";

export default class AntiNukeChannelDeleteListener extends Event {
  constructor(client: Bot, file: string) {
    super(client, file, {
      name: "channelDelete",
      once: false,
    });
  }

  public async run(channel: Channel): Promise<void> {
    if (!("guild" in channel)) return;

    const protection = await runAntiNukeProtectionDetailed(this.client, channel.guild, "channelDelete", `channelDelete:${(channel as any).name || channel.id}`);
    if (!protection.enforced) return;

    if (!("permissionOverwrites" in channel)) return;

    const autoRecoveryEnabled = await isAutoRecoveryEnabled(channel.guild.id);
    if (!autoRecoveryEnabled) return;

    const recovered = await recoverDeletedChannel(channel as any);
    if (!recovered) return;

    await sendRecoveryReport(channel.guild, "Channel Restored", `Recovered deleted channel: **${(channel as any).name || channel.id}**`);
  }
}
