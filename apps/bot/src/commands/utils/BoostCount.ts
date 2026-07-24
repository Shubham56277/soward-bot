import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

export default class BoostCount extends Command {
    constructor() {
        super({
            name: 'boostcount',
            description: {
                content: 'Shows the server boost count',
                examples: ['boostcount'],
                usage: 'boostcount',
            },
            category: 'utils',
            aliases: ['boosts', "bc"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const panel = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                [
                    `## ${ctx.guild.name}'s Boost Status`,
                    `**Boost Count:** ${ctx.guild.premiumSubscriptionCount}`,
                    `**Boost Level:** Level ${ctx.guild.premiumTier}`,
                ].join("\n")
            ));

        return ctx.sendMessage({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
}