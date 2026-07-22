import { ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Gend from "./gend";
import Glist from "./glist";
import Gpause from "./gpause";
import GreqRole from "./greq-role";
import Greroll from "./greroll";
import Gresume from "./gresume";
import Gstart from "./gstart";

const handlers = {
	create: new Gstart(),
	end: new Gend(),
	reroll: new Greroll(),
	list: new Glist(),
	pause: new Gpause(),
	resume: new Gresume(),
	requirements: new GreqRole(),
} as const;

export default class Giveaway extends Command {
	public constructor() {
		super({
			name: "giveaway",
			description: { content: "Create and manage giveaways", examples: ["giveaway create duration:1h winners:1 prize:Nitro"], usage: "giveaway <action>" },
			category: "giveaway",
			cooldown: 5,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [
				{ name: "create", description: "Create a giveaway", type: ApplicationCommandOptionType.Subcommand, options: [
					{ name: "duration", description: "Duration", type: ApplicationCommandOptionType.String, required: true },
					{ name: "winners", description: "Number of winners", type: ApplicationCommandOptionType.Integer, required: true },
					{ name: "prize", description: "Prize", type: ApplicationCommandOptionType.String, required: true },
				] },
				...(["end", "reroll", "pause", "resume"].map((name) => ({ name, description: `${name} a giveaway`, type: ApplicationCommandOptionType.Subcommand, options: [{ name: "message", description: "Giveaway message ID", type: ApplicationCommandOptionType.String, required: true }] })) as any),
				{ name: "list", description: "List active giveaways", type: ApplicationCommandOptionType.Subcommand },
				{ name: "requirements", description: "Manage giveaway role requirement", type: ApplicationCommandOptionType.SubcommandGroup, options: [
					{ name: "set", description: "Set required role", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "role", description: "Required role", type: ApplicationCommandOptionType.Role, required: true }] },
					{ name: "clear", description: "Clear required role", type: ApplicationCommandOptionType.Subcommand },
				] },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const group = ctx.options.getSubcommandGroup(false);
		const action = (group === "requirements" ? "requirements" : ctx.options.getSubCommand(true, 0)) as keyof typeof handlers;
		return handlers[action]?.run(ctx) ?? ctx.sendMessage("That giveaway action is not available.");
	}
}
