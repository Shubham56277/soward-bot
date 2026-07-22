import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class ClearQueue extends Command {
    constructor() {
        super({
            name: 'clearqueue',
            description: {
                content: 'Clear the current queue',
                examples: ['clearqueue'],
                usage: 'clearqueue',
            },
            category: 'music',
            aliases: ['cq'],
            cooldown: 5,
            args: false,
            vote: true,
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

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The queue is already empty",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.queue.tracks.splice(0, player.queue.tracks.length);

        const embed = new EmbedBuilder()
            .setDescription("The queue has been cleared")
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
