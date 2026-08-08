import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { messageTracker } from "../../modules/MessageTracker";

const V2 = MessageFlags.IsComponentsV2;

function panel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${body}`));
}

export default class ClearSnipe extends Command {
	constructor() {
		super({
			name: "clearsnipe",
			description: {
				content: "Clear all sniped (deleted and edited) messages in this channel",
				examples: ["clearsnipe"],
				usage: "clearsnipe",
			},
			category: "utils",
			aliases: ["cs", "clearsnipes"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["ViewChannel", "SendMessages", "EmbedLinks"],
				user: ["ManageMessages"],
			},
			slashCommand: false,
		});
	}

	public async run(ctx: Context): Promise<any> {
		const removed = await messageTracker.clearChannel(ctx.client.redis, ctx.channel.id);
		const body = removed > 0 ? "Cleared all deleted and edited snipe data for this channel." : "There was no snipe data to clear in this channel.";
		return ctx.sendMessage({ components: [panel("Snipe cleared", body)], flags: V2, allowedMentions: { parse: [] } });
	}
}
