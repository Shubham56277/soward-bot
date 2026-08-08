import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, TextChannel } from "discord.js";

export default class Clone extends Command {
    constructor() {
        super({
            name: 'clone',
            description: {
                content: 'Clones the current channel',
                examples: ['clone'],
                usage: 'clone',
            },
            category: 'moderation',
            aliases: ['duplicate'],
            cooldown: 30,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['ManageChannels'],
                user: ['ManageChannels'],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const channel = ctx.channel as TextChannel;
        if (!channel) return ctx.sendMessage('This command can only be used in text channels.');

        const clone = await channel.clone({
            reason: `Channel cloned by ${ctx.author?.tag}`,
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Channel Cloned**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Successfully cloned #${channel.name} to #${clone.name}`));

        await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return clone.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
