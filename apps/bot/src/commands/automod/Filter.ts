import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import BadWord from "./Badword";

export default class Filter extends Command {
	private readonly words = new BadWord();
	public constructor() {
		super({
			name: "filter",
			description: { content: "Manage automated word filters", examples: ["filter words add word:spam"], usage: "filter words <add|remove|list|reset>" },
			category: "automod",
			cooldown: 5,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "ManageGuild"], user: ["Administrator"] },
			options: [{ name: "words", description: "Manage filtered words", type: ApplicationCommandOptionType.SubcommandGroup, options: [
				{ name: "add", description: "Add a word", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "word", description: "Word to add", type: ApplicationCommandOptionType.String, required: true }] },
				{ name: "remove", description: "Remove a word", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "word", description: "Word to remove", type: ApplicationCommandOptionType.String, required: true }] },
				{ name: "list", description: "List filtered words", type: ApplicationCommandOptionType.Subcommand },
				{ name: "reset", description: "Clear filtered words", type: ApplicationCommandOptionType.Subcommand },
			] }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (ctx.options.getSubCommand(true, 1) === "reset" && ctx.isInteraction) {
			(ctx.interaction!.options as any).getSubcommand = () => "clear";
		}
		return this.words.run(ctx);
	}
}
