import Command from "../../abstract/Command";
import BaseClient from "../../base/Client";
import Context from "../../lib/Context";
import { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from "discord.js";

export default class BadWord extends Command {
    client!: BaseClient
    constructor() {
        super({
            name: 'badword',
            description: {
                content: 'Configure bad words filtering for your server',
                examples: ['badword add word', 'badword remove word', 'badword list'],
                usage: 'badword <add|remove|list|clear>',
            },
            category: 'automod',
            aliases: ['bw', 'filter'],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: ["Administrator"],
            },
            slashCommand: false,
            options: [
                {
                    name: 'add',
                    description: 'Add a word to the filter',
                    type: 1,
                    options: [
                        {
                            name: 'word',
                            description: 'The word to add to the filter',
                            type: 3,
                            required: true,
                        }
                    ]
                },
                {
                    name: 'remove',
                    description: 'Remove a word from the filter',
                    type: 1,
                    options: [
                        {
                            name: 'word',
                            description: 'The word to remove from the filter',
                            type: 3,
                            required: true,
                        }
                    ]
                },
                {
                    name: 'list',
                    description: 'List all filtered words',
                    type: 1,
                },
                {
                    name: 'clear',
                    description: 'Clear all filtered words',
                    type: 1,
                }
            ],
        });
    }

    private createEmbed(title: string, description: string, color: number, client = this.client): EmbedBuilder {
        return new EmbedBuilder()
            .setTitle(`📝 ${title}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp()
            .setFooter({ text: 'Soward Filter System', iconURL: client.user!.displayAvatarURL() });
    }

    private createConfirmationButtons() {
        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_clear')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_clear')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        return new ActionRowBuilder<ButtonBuilder>()
            .addComponents(confirmButton, cancelButton);
    }

    public async run(ctx: Context): Promise<any> {
        this.client = ctx.client;
        const subCommand = ctx.isInteraction ? ctx.options.getSubCommand() : ctx.args[0]?.toLowerCase();

        if (!subCommand) {
            const helpEmbed = this.createEmbed(
                'Word Filter Help',
                `**Available Commands:**
                • \`/badword add <word>\` - Add a word to the filter
                • \`/badword remove <word>\` - Remove a word from the filter
                • \`/badword list\` - View all filtered words
                • \`/badword clear\` - Remove all filtered words
                
                ℹ️ **Note:** Filtered words will be blocked in all channels`,
                ctx.client.config.colors.orange
            );
            return ctx.editOrReply({ embeds: [helpEmbed] });
        }

        if (subCommand === 'add') {
            let badword = ctx.options?.getString('word', true);
            if (!ctx.isInteraction) badword = ctx.args.slice(1).join(' ');

            if (!badword) {
                const errorEmbed = this.createEmbed(
                    'Missing Word',
                    '<:Cross:1375519752746958858> Please specify a word to add to the filter.',
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [errorEmbed] });
            }

            const guild = await ctx.client.guilds.fetch(ctx.guild.id);
            const rules = await guild.autoModerationRules.fetch();
            const rule = rules.find(r => r.name === 'soward badwords');

            try {
                if (!rule) {
                    await guild.autoModerationRules.create({
                        name: 'soward badwords',
                        eventType: 1,
                        triggerType: 1,
                        triggerMetadata: {
                            keywordFilter: [badword.toLowerCase()],
                        },
                        actions: [{
                            type: 1,
                            metadata: {
                                customMessage: '🛑 Your message was blocked for containing inappropriate language (Soward Filter)',
                            }
                        }],
                        enabled: true,
                        exemptRoles: [],
                        exemptChannels: []
                    });

                    const embed = this.createEmbed(
                        'Word Added to Filter',
                        `<:Tick:1375519268292264012> Successfully created filter and added: \`${badword}\`\n\n**Important:** Do not rename the filter rule "soward badwords" in server settings.`,
                        ctx.client.config.colors.main
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                if (rule.triggerMetadata.keywordFilter.includes(badword.toLowerCase())) {
                    const embed = this.createEmbed(
                        'Word Already Filtered',
                        `ℹ️ The word \`${badword}\` is already in the filter.`,
                        ctx.client.config.colors.orange
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                const updatedKeywords = [...rule.triggerMetadata.keywordFilter, badword.toLowerCase()];
                await rule.edit({
                    triggerMetadata: {
                        keywordFilter: updatedKeywords,
                    },
                });

                const embed = this.createEmbed(
                    'Word Added to Filter',
                    `<:Tick:1375519268292264012> Successfully added \`${badword}\` to the filter.\n\nUse \`/badword list\` to see all filtered words.`,
                    ctx.client.config.colors.main
                );
                return ctx.editOrReply({ embeds: [embed] });

            } catch (error: any) {
                const embed = this.createEmbed(
                    'Error Adding Word',
                    `<:Cross:1375519752746958858> Failed to add word: ${error.message}\n\nPlease check that the bot has the required permissions.`,
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [embed] });
            }
        }

        if (subCommand === 'remove') {
            let badword = ctx.options?.getString('word', true);
            if (!ctx.isInteraction) badword = ctx.args.slice(1).join(' ');

            if (!badword) {
                const errorEmbed = this.createEmbed(
                    'Missing Word',
                    '<:Cross:1375519752746958858> Please specify a word to remove from the filter.',
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [errorEmbed] });
            }

            const guild = await ctx.client.guilds.fetch(ctx.guild.id);
            const rules = await guild.autoModerationRules.fetch();
            const rule = rules.find(r => r.name === 'soward badwords');

            try {
                if (!rule) {
                    const embed = this.createEmbed(
                        'No Filter Active',
                        '<:Cross:1375519752746958858> There is no word filter active on this server.',
                        ctx.client.config.colors.orange
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                if (!rule.triggerMetadata.keywordFilter.includes(badword.toLowerCase())) {
                    const embed = this.createEmbed(
                        'Word Not Found',
                        `<:Cross:1375519752746958858> The word \`${badword}\` is not in the filter.\n\nUse \`/badword list\` to see all filtered words.`,
                        ctx.client.config.colors.orange
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                const updatedKeywords = rule.triggerMetadata.keywordFilter.filter(word => word !== badword.toLowerCase());

                if (updatedKeywords.length === 0) {
                    await rule.delete();
                    const embed = this.createEmbed(
                        'Filter Removed',
                        `<:Tick:1375519268292264012> Removed the last word (\`${badword}\`) and disabled the filter.\n\nThe filter will be recreated when you add a new word.`,
                        ctx.client.config.colors.main
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                await rule.edit({
                    triggerMetadata: {
                        keywordFilter: updatedKeywords,
                    },
                });

                const embed = this.createEmbed(
                    'Word Removed',
                    `<:Tick:1375519268292264012> Successfully removed \`${badword}\` from the filter.\n\n${updatedKeywords.length} word${updatedKeywords.length !== 1 ? 's' : ''} still filtered.`,
                    ctx.client.config.colors.main
                );
                return ctx.editOrReply({ embeds: [embed] });

            } catch (error: any) {
                const embed = this.createEmbed(
                    'Error Removing Word',
                    `<:Cross:1375519752746958858> Failed to remove word: ${error.message}`,
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [embed] });
            }
        }

        if (subCommand === 'list') {
            try {
                const guild = await ctx.client.guilds.fetch(ctx.guild.id);
                const rules = await guild.autoModerationRules.fetch();
                const rule = rules.find(r => r.name === 'soward badwords');

                if (!rule || rule.triggerMetadata.keywordFilter.length === 0) {
                    const embed = this.createEmbed(
                        'No Filtered Words',
                        '📝 There are no words currently being filtered.\n\nAdd words with `/badword add <word>`.',
                        ctx.client.config.colors.orange
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                const words = rule.triggerMetadata.keywordFilter;
                const wordCount = words.length;

                const embed = this.createEmbed(
                    'Filtered Words',
                    `📋 Currently filtering **${wordCount}** word${wordCount !== 1 ? 's' : ''}.\n\n*Use \`/badword remove <word>\` to remove specific words.*`,
                    ctx.client.config.colors.orange
                );

                if (words.length > 0) {
                    // Split into chunks of 15 words to avoid exceeding embed limits
                    const chunks = [];
                    for (let i = 0; i < words.length; i += 15) {
                        chunks.push(words.slice(i, i + 15));
                    }

                    chunks.forEach((chunk, index) => {
                        embed.addFields({
                            name: index === 0 ? '📝 Words' : '📝 More Words',
                            value: chunk.map(w => `\`${w}\``).join(', '),
                            inline: false
                        });
                    });
                }

                return ctx.editOrReply({ embeds: [embed] });

            } catch (error: any) {
                const embed = this.createEmbed(
                    'Error',
                    `<:Cross:1375519752746958858> Failed to list words: ${error.message}`,
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [embed] });
            }
        }

        if (subCommand === 'clear') {
            try {
                const guild = await ctx.client.guilds.fetch(ctx.guild.id);
                const rules = await guild.autoModerationRules.fetch();
                const rule = rules.find(r => r.name === 'soward badwords');

                if (!rule || rule.triggerMetadata.keywordFilter.length === 0) {
                    const embed = this.createEmbed(
                        'No Filtered Words',
                        '📝 There are no words currently being filtered.',
                        ctx.client.config.colors.orange
                    );
                    return ctx.editOrReply({ embeds: [embed] });
                }

                const wordCount = rule.triggerMetadata.keywordFilter.length;

                const confirmEmbed = this.createEmbed(
                    'Confirm Clear Filter',
                    `⚠️ Are you sure you want to remove **all ${wordCount} filtered words**?\n\nThis action cannot be undone.`,
                    ctx.client.config.colors.orange
                );

                // For interaction commands, we can use buttons
                if (ctx.isInteraction) {
                    const buttons = this.createConfirmationButtons();
                    const response = await ctx.editOrReply({
                        embeds: [confirmEmbed],
                        components: [buttons]
                    });

                    try {
                        const confirmation = await response.awaitMessageComponent({
                            filter: i => i.user.id === ctx.author?.id,
                            time: 30000
                        });

                        if (confirmation.customId === 'confirm_clear') {
                            await rule.delete();

                            const successEmbed = this.createEmbed(
                                'Filter Cleared',
                                `<:Tick:1375519268292264012> Successfully removed all ${wordCount} filtered words.\n\nYou can add new words with \`/badword add <word>\`.`,
                                ctx.client.config.colors.main
                            );

                            await confirmation.update({
                                embeds: [successEmbed],
                                components: []
                            });
                        } else {
                            const cancelEmbed = this.createEmbed(
                                'Action Cancelled',
                                '⚠️ Word filter clear operation cancelled.',
                                ctx.client.config.colors.orange
                            );

                            await confirmation.update({
                                embeds: [cancelEmbed],
                                components: []
                            });
                        }
                    } catch (error) {
                        // Button timed out
                        const timeoutEmbed = this.createEmbed(
                            'Action Cancelled',
                            '⏱️ Confirmation timed out. No changes were made to the filter.',
                            ctx.client.config.colors.orange
                        );

                        await response.edit({
                            embeds: [timeoutEmbed],
                            components: []
                        });
                    }
                } else {
                    // For text commands, just clear immediately
                    await rule.delete();

                    const successEmbed = this.createEmbed(
                        'Filter Cleared',
                        `<:Tick:1375519268292264012> Successfully removed all ${wordCount} filtered words.\n\nYou can add new words with \`/badword add <word>\`.`,
                        ctx.client.config.colors.main
                    );

                    return ctx.editOrReply({ embeds: [successEmbed] });
                }
            } catch (error: any) {
                const embed = this.createEmbed(
                    'Error',
                    `<:Cross:1375519752746958858> Failed to clear words: ${error.message}`,
                    ctx.client.config.colors.red
                );
                return ctx.editOrReply({ embeds: [embed] });
            }
        }
    }
}
