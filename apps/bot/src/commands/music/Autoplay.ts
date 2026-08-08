import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";



export default class Autoplay extends Command {
    constructor() {
        super({
            name: 'autoplay',
            description: {
                content: 'Enable or disable autoplay',
                examples: ['autoplay'],
                usage: 'autoplay',
            },
            category: 'music',
            aliases: ['ap'],
            cooldown: 5,
            args: false,
            vote: true,
            premium: true,
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

        const autoplay = player.get<boolean>('autoplay');

        player.set('autoplay', !autoplay);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(autoplay ? "Autoplay has been disabled" : "Autoplay has been enabled"));

        await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
