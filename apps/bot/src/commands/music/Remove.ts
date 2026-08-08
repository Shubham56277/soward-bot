import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
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

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage(this.msg("There are no songs in the queue to remove"));
        }

        const songNumber = Number(args[0]);
        if (Number.isNaN(songNumber) || songNumber <= 0 || songNumber > player.queue.tracks.length) {
            return await ctx.sendMessage(this.msg(`Please provide a valid number between 1 and ${player.queue.tracks.length}`));
        }

        const removedTrack = player.queue.tracks[songNumber - 1];
        player.queue.remove(songNumber - 1);

        await ctx.sendMessage(this.msg(`Removed track #${songNumber}: **${removedTrack?.info.title}**`));
    }
}
