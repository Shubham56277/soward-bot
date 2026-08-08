import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
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

        const trackNumber = Number(args[0]);
        if (Number.isNaN(trackNumber) || trackNumber <= 0) {
            return await ctx.sendMessage(this.msg("Please provide a valid track number"));
        }

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage(this.msg("The queue is empty - nothing to skip to"));
        }

        if (trackNumber < 1 || trackNumber > player.queue.tracks.length) {
            return await ctx.sendMessage(this.msg(`Please provide a track number between 1 and ${player.queue.tracks.length}`));
        }

        const skippedTrack = player.queue.tracks[trackNumber - 1];
        player.skip(trackNumber);

        await ctx.sendMessage(this.msg(`Skipped to track #${trackNumber}: **${skippedTrack?.info.title}**`));
    }
}
