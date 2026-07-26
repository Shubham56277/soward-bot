import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Stop extends Command {
    constructor() {
        super({
            name: 'stop',
            description: {
                content: 'Stop the music',
                examples: ['stop'],
                usage: 'stop',
            },
            category: 'music',
            aliases: ['st'],
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) return await ctx.sendMessage("Player is not connected");

        player.stopPlaying(true, false);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("**Music Stopped**"))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("The music has been stopped and the queue has been cleared."));

        return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
