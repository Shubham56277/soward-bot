import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

export default class Vote extends Command {
    constructor() {
        super({
            name: "vote",
            description: {
                content: "Vote for the bot on top.gg",
                examples: ["vote"],
                usage: "vote",
            },
            category: 'utils',
            aliases: ["support"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const panel = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Vote for the Bot!\nHelp support the bot by voting on top.gg!"));

        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Vote")
                    .setURL("https://top.gg/bot/1013771497157972008/vote")
                    .setStyle(ButtonStyle.Link),
            );
        return ctx.sendMessage({ components: [panel, button], flags: MessageFlags.IsComponentsV2 });
    }
}
