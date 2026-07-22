import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";

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
        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle(`${ctx.guild.name}'s Boost Status`)
            .addFields([
                { name: 'Boost Count', value: `${ctx.guild.premiumSubscriptionCount}` },
                { name: 'Boost Level', value: `Level ${ctx.guild.premiumTier}` }
            ]);

        return ctx.sendMessage({ embeds: [embed] });
    }
}