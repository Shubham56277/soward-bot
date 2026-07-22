import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Nick from "./Nick";

export default class Nickname extends Command {
	private readonly handler = new Nick();

	public constructor() {
		super({
			name: "nickname",
			description: { content: "Set or reset a member nickname", examples: ["nickname set user:@member nickname:New name"], usage: "nickname <set|reset>" },
			category: "moderation",
			cooldown: 5,
			slashCommand: true,
			permissions: { dev: false, client: ["ManageNicknames", "ViewChannel", "EmbedLinks", "SendMessages"], user: ["ManageNicknames"] },
			options: [
				{ name: "set", description: "Set a member nickname", type: ApplicationCommandOptionType.Subcommand, options: [
					{ name: "user", description: "Member to rename", type: ApplicationCommandOptionType.User, required: true },
					{ name: "nickname", description: "New nickname", type: ApplicationCommandOptionType.String, required: true, max_length: 32 },
				] },
				{ name: "reset", description: "Reset a member nickname", type: ApplicationCommandOptionType.Subcommand, options: [
					{ name: "user", description: "Member to reset", type: ApplicationCommandOptionType.User, required: true },
				] },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		return this.handler.run(ctx);
	}
}
