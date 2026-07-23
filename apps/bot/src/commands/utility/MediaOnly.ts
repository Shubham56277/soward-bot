import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Media from "../moderation/Media";

export default class MediaOnly extends Command {
	private readonly handler = new Media();

	public constructor() {
		super({
			name: "media-only",
			description: { content: "Manage media-only channels", examples: ["media-only add channel:#media"], usage: "media-only <add|remove|list>" },
			category: "utils",
			cooldown: 10,
			slashCommand: true,
			permissions: { dev: false, client: ["ManageChannels", "ManageMessages", "ManageWebhooks"], user: ["ManageChannels"] },
			options: [
				{ name: "add", description: "Add a media-only channel", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "channel", description: "Text channel", type: ApplicationCommandOptionType.Channel, channel_types: [ChannelType.GuildText], required: true }] },
				{ name: "remove", description: "Remove a media-only channel", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "channel", description: "Text channel", type: ApplicationCommandOptionType.Channel, channel_types: [ChannelType.GuildText], required: true }] },
				{ name: "list", description: "List media-only channels", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		return this.handler.run(ctx);
	}
}
