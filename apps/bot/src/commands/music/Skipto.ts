import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Skipto extends Command {
    constructor() {
        super({
            name: 'skipto',
            description: {
                content: 'Skip to a specific track in the queue',
                examples: ['skipto 3'],
                usage: 'skipto <track number>',
            },
            category: 'music',
            aliases: ['skt'],
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
                    name: 'number',
                    description: 'The track number to skip to',
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

        const trackNumber = Number(args[0]);
        if (Number.isNaN(trackNumber) || trackNumber <= 0) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "Please provide a valid track number",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The queue is empty - nothing to skip to",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        if (trackNumber < 1 || trackNumber > player.queue.tracks.length) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: `Please provide a track number between 1 and ${player.queue.tracks.length}`,
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const skippedTrack = player.queue.tracks[trackNumber - 1];
        player.skip(trackNumber);

        const embed = new EmbedBuilder()
            .setDescription(`⏭️ Skipped to track #${trackNumber}: **${skippedTrack?.info.title}**`)
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
