import { ApplicationCommandOptionType, ChannelType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { createInfoPanel } from "../../utils/infoPanel";

export default class ChannelInfo extends Command {
	public constructor() {
		super({
			name: "channelinfo",
			description: { content: "View information about a server channel", examples: ["channelinfo", "channelinfo #general"], usage: "channelinfo [channel]" },
			category: "utils",
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: [] },
			options: [{ name: "channel", description: "Channel to inspect", type: ApplicationCommandOptionType.Channel, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const channel = (ctx.options.getChannel("channel", false) ?? ctx.channel) as any;
		if (!("createdTimestamp" in channel) || !("name" in channel)) return ctx.sendMessage("That channel cannot be inspected.");
		const type = (typeof channel.type === "number" ? ChannelType[channel.type] : String(channel.type)) || "Unknown";
		const rows: Array<[string, string]> = [
			["Channel", `${channel.name} (\`${channel.id}\`)`],
			["Type", type],
			["Created", `<t:${Math.floor(channel.createdTimestamp / 1_000)}:R>`],
		];
		if ("topic" in channel && channel.topic) rows.push(["Topic", String(channel.topic).slice(0, 500)]);
		if ("rateLimitPerUser" in channel) rows.push(["Slowmode", `${channel.rateLimitPerUser || 0}s`]);
		return ctx.sendMessage({ components: [createInfoPanel(ctx, "Channel Information", "Current channel configuration.", rows)], flags: MessageFlags.IsComponentsV2 });
	}
}
