import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import ms from "@lukeed/ms";
export default class Seek extends Command {
    constructor() {
        super({
            name: 'seek',
            description: {
                content: 'Seek to a specific position in the current track',
                examples: ['seek 1m', 'seek 1h 30m', 'seek 1h 30m 30s'],
                usage: 'seek <duration>',
            },
            category: 'music',
            aliases: ['s'],
            cooldown: 5,
            args: true,
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
            options: [
                {
                    name: 'duration',
                    description: 'The duration to seek to (e.g. 1m 30s)',
                    type: 3, // STRING type
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

        const currentTrack = player.queue.current?.info;
        if (!currentTrack) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "There is no track currently playing",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const duration = ms.parse(args.join(' '));
        if (!duration) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "Invalid time format. Please use formats like: 1m, 1h 30m, or 1h 30m 30s",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        if (!currentTrack.isSeekable || currentTrack.isStream) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "This track is not seekable",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        if (duration > currentTrack.duration) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: `The duration exceeds the track length (${ms.format(currentTrack.duration)})`,
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.seek(duration);

        const embed = new EmbedBuilder()
            .setDescription(`Seeked to ${ms.format(duration)}`)
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
