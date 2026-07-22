import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Logger from "../settings/Logger";

export default class Logging extends Command {
	private readonly handler = new Logger();

	public constructor() {
		super({
			name: "logging",
			description: { content: "Configure server event logging", examples: ["logging"], usage: "logging" },
			category: "logging",
			cooldown: 5,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"], user: ["Administrator"] },
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		return this.handler.run(ctx);
	}
}
