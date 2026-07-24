import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Reverse extends Command {
    constructor() {
        super({
            name: "reverse",
            description: {
                content: "Reverse any text",
                examples: ["reverse Hello World"],
                usage: "reverse <text>",
            },
            category: "fun",
            cooldown: 3,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "text",
                    description: "The text to reverse",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const text = ctx.isInteraction
            ? ctx.options.getString("text", true)
            : ctx.args.join(" ");

        if (!text) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide some text to reverse."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reversed = [...text].reverse().join("");

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Original:** ${text}`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reversed:** ${reversed}`));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
