import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";



export default class Autoplay extends Command {
    constructor() {
        super({
            name: 'autoplay',
            description: {
                content: 'Enable or disable autoplay',
                examples: ['autoplay'],
                usage: 'autoplay',
            },
            category: 'music',
            aliases: ['ap'],
            cooldown: 5,
            args: false,
            vote: true,
            premium: true,
            player: {
                voice: true,
                active: true,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "Player is not connected",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const embed = new EmbedBuilder();
        const autoplay = player.get<boolean>('autoplay');

        player.set('autoplay', !autoplay);

        if (autoplay) {
            embed.setDescription("Autoplay has been disabled").setColor(ctx.client.config.colors.red);
        } else {
            embed.setDescription("Autoplay has been enabled").setColor(ctx.client.config.colors.main);
        }

        await ctx.sendMessage({ embeds: [embed] });
    }
}
