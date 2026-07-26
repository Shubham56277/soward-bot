import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context, args: string[]): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage(this.msg("Player is not connected"));
        }

        const currentTrack = player.queue.current?.info;
        if (!currentTrack) {
            return await ctx.sendMessage(this.msg("There is no track currently playing"));
        }

        const duration = ms.parse(args.join(' '));
        if (!duration) {
            return await ctx.sendMessage(this.msg("Invalid time format. Please use formats like: 1m, 1h 30m, or 1h 30m 30s"));
        }

        if (!currentTrack.isSeekable || currentTrack.isStream) {
            return await ctx.sendMessage(this.msg("This track is not seekable"));
        }

        if (duration > currentTrack.duration) {
            return await ctx.sendMessage(this.msg(`The duration exceeds the track length (${ms.format(currentTrack.duration)})`));
        }

        player.seek(duration);

        await ctx.sendMessage(this.msg(`Seeked to ${ms.format(duration)}`));
    }
}
