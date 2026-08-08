import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";


export default class Leave extends Command {
    constructor() {
        super({
            name: 'leave',
            description: {
                content: 'Leave a voice channel',
                examples: ['leave'],
                usage: 'leave',
            },
            category: 'music',
            aliases: ['l'],
            cooldown: 5,
            args: false,
            vote: false,
            player: {
                voice: true,
                active: false
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

        if (player) {
            const channelId = player.voiceChannelId;
            player.destroy();
            return await ctx.sendMessage(this.msg(`Successfully left <#${channelId}>`));
        }
        return await ctx.sendMessage(this.msg("Player is not connected"));
    }
}
