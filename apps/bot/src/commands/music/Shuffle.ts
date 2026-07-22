import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Shuffle extends Command {
    constructor() {
        super({
            name: 'shuffle',
            description: {
                content: 'Shuffle the current queue',
                examples: ['shuffle'],
                usage: 'shuffle',
            },
            category: 'music',
            aliases: ['sh'],
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

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The queue is empty - nothing to shuffle",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.queue.shuffle();

        const embed = new EmbedBuilder()
            .setDescription("🔀 Shuffled the queue")
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
