import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Replay extends Command {
    constructor() {
        super({
            name: 'replay',
            description: {
                content: 'Replay the current track from the beginning',
                examples: ['replay'],
                usage: 'replay',
            },
            category: 'music',
            aliases: ['rp'],
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage(this.msg("No music is currently playing"));
        }

        const currentTrack = player.queue.current;
        if (!currentTrack?.info.isSeekable) {
            return await ctx.sendMessage(this.msg("The current track cannot be replayed"));
        }

        player.seek(0);

        await ctx.sendMessage(this.msg("Replaying the current track from the beginning"));
    }
}
