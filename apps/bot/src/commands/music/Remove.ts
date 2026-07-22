import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Remove extends Command {
    constructor() {
        super({
            name: 'remove',
            description: {
                content: 'Remove a song from the queue',
                examples: ['remove 1'],
                usage: 'remove <song number>',
            },
            category: 'music',
            aliases: ['rm'],
            cooldown: 5,
            args: true,
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
            options: [
                {
                    name: 'song',
                    description: 'The song number to remove',
                    type: 4, // INTEGER type
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context, args: string[]): Promise<any> {
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
                        description: "There are no songs in the queue to remove",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const songNumber = Number(args[0]);
        if (Number.isNaN(songNumber) || songNumber <= 0 || songNumber > player.queue.tracks.length) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: `Please provide a valid number between 1 and ${player.queue.tracks.length}`,
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const removedTrack = player.queue.tracks[songNumber - 1];
        player.queue.remove(songNumber - 1);

        const embed = new EmbedBuilder()
            .setDescription(`Removed track #${songNumber}: **${removedTrack?.info.title}**`)
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
