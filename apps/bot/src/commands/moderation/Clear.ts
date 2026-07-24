import { ApplicationCommandOptionType, TextChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import * as reply from "../../utils/reply";

export default class Clear extends Command {
	public constructor() {
		super({
			name: "clear",
			description: { content: "Quickly delete a specific number of recent messages", examples: ["clear 20"], usage: "clear <amount>" },
			category: "moderation",
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "ManageMessages"], user: ["ManageMessages"] },
			options: [{ name: "amount", description: "Messages to delete", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 100 }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		if (!(ctx.channel instanceof TextChannel)) return reply.error(ctx, "This command can only be used in a text channel");
		const raw = ctx.options.getInteger("amount", true, 0);
		const amount = Number(raw);
		if (!Number.isInteger(amount) || amount < 1 || amount > 100) return reply.error(ctx, "Choose an amount from 1 to 100");
		const deleted = await ctx.channel.bulkDelete(amount, true);
		return reply.temporary(ctx, `-# Deleted **${deleted.size}** recent message${deleted.size === 1 ? "" : "s"}`, 3_000);
	}
}
