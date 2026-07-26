import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
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
                components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Player is not connected"))],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        if (player.queue.tracks.length === 0) {
            return await ctx.sendMessage({
                components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("The queue is already empty"))],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        player.queue.tracks.splice(0, player.queue.tracks.length);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("The queue has been cleared"));

        await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
