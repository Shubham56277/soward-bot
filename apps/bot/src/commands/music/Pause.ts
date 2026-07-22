import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Pause extends Command {
    constructor() {
        super({
            name: 'pause',
            description: {
                content: 'Pause the current track',
                examples: ['pause'],
                usage: 'pause',
            },
            category: 'music',
            aliases: ['pu'],
            cooldown: 5,
            args: false,
            vote: false,
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

        if (player.paused) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The player is already paused",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.pause();

        const embed = new EmbedBuilder()
            .setDescription("Paused the current track")
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
