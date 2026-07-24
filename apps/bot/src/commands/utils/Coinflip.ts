import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Coinflip extends Command {
    constructor() {
        super({
            name: "coinflip",
            description: {
                content: "Flip a coin",
                examples: ["coinflip"],
                usage: "coinflip",
            },
            category: "utils",
            cooldown: 3,
            args: false,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const result = Math.random() < 0.5 ? "🪙 **Heads!**" : "🪙 **Tails!**";

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(result));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
