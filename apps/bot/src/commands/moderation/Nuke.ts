import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from "discord.js";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class Nuke extends Command {
    constructor() {
        super({
            name: 'nuke',
            description: {
                content: 'Nukes the current channel (deletes all messages)',
                examples: ['nuke'],
                usage: 'nuke',
            },
            category: 'moderation',
            aliases: ['purgeall'],
            cooldown: 60,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: [
                    'ManageChannels',
                    'ManageWebhooks'
                ],
                user: ['ManageChannels'],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const channel = ctx.channel as TextChannel;
        if (!channel) return ctx.sendMessage('This command can only be used in text channels.');

        // Confirmation panel
        const confirmContainer = buildPanel(
            'Channel Nuke Confirmation',
            'Are you sure you want to nuke this channel? This will delete ALL messages and cannot be undone!\n\n-# This action will timeout in 30 seconds',
        );

        const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('confirm_nuke').setLabel('Confirm Nuke').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_nuke').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        let lastContainer: ContainerBuilder = confirmContainer;

        const confirmMsg = await ctx.sendMessage({
            components: [confirmContainer, actionRow],
            flags: MessageFlags.IsComponentsV2,
        });

        // Button collector
        const filter = (i: any) => i.user.id === ctx.author?.id;
        const collector = confirmMsg.createMessageComponentCollector({
            filter,
            time: 30000,
            max: 1
        });

        collector.on('collect', async (i: any) => {
            if (i.customId === 'confirm_nuke') {

                // Clone the channel
                const clone = await channel.clone({
                    reason: `Channel nuked by ${ctx.author?.tag}`,
                });

                // Delete original channel
                await channel.delete(`Nuked by ${ctx.author?.tag}`);

                // Send confirmation to the clone
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Channel Nuked**`))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`This channel was nuked by ${ctx.author}`));

                await clone.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                lastContainer = buildPanel('Nuke Cancelled', 'Channel nuke cancelled.');
                await confirmMsg.edit({
                    components: [lastContainer],
                    flags: MessageFlags.IsComponentsV2,
                });
            }
        });

        collector.on('end', () => {
            confirmMsg.edit({ components: [lastContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
}
