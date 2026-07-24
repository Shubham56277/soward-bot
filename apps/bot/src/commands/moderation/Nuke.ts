import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder, TextChannel } from "discord.js";

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

        // Confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('⚠️ Channel Nuke Confirmation')
            .setDescription('Are you sure you want to nuke this channel? This will delete ALL messages and cannot be undone!')
            .setFooter({ text: 'This action will timeout in 30 seconds' });

        const confirmMsg = await ctx.sendMessage({ 
            embeds: [confirmEmbed],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 4,
                            label: 'Confirm Nuke',
                            customId: 'confirm_nuke'
                        },
                        {
                            type: 2,
                            style: 2,
                            label: 'Cancel',
                            customId: 'cancel_nuke'
                        }
                    ]
                }
            ]
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
                const embed = new EmbedBuilder()
                    .setColor(0x000000)
                    .setTitle('Channel Nuked 💥')
                    .setDescription(`This channel was nuked by ${ctx.author}`); 

                await clone.send({ embeds: [embed] });
            } else {
                await confirmMsg.edit({
                    content: 'Channel nuke cancelled.',
                    embeds: [],
                    components: []
                });
            }
        });

        collector.on('end', () => {
            confirmMsg.edit({ components: [] }).catch(() => {});
        });
    }
}