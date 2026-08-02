import Command from "../../abstract/Command";
import BaseClient from "../../base/Client";
import Context from "../../lib/Context";
import { ButtonBuilder, ActionRowBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import Help from "../utils/Help";

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
            args: false,
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

    private createEmbed(title: string, description: string, _color?: number, extraFields: { name: string; value: string }[] = []): { components: ContainerBuilder[]; flags: MessageFlags } {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(description));

        for (const field of extraFields) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${field.name}**\n${field.value}`));
        }

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Soward Filter System"));

        return { components: [container], flags: MessageFlags.IsComponentsV2 };
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
            return new Help().showCommand(ctx, "badword");
        }

        if (subCommand === 'add') {
            let badword = ctx.options?.getString('word', true);
            if (!ctx.isInteraction) badword = ctx.args.slice(1).join(' ');

            if (!badword) {
                return ctx.editOrReply(this.createEmbed(
                    'Missing Word',
                    'Please specify a word to add to the filter.',
                ));
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
                                customMessage: 'Your message was blocked for containing inappropriate language (Soward Filter)',
                            }
                        }],
                        enabled: true,
                        exemptRoles: [],
                        exemptChannels: []
                    });

                    return ctx.editOrReply(this.createEmbed(
                        'Word Added to Filter',
                        `Successfully created filter and added: \`${badword}\`\n\n**Important:** Do not rename the filter rule "soward badwords" in server settings.`,
                    ));
                }

                if (rule.triggerMetadata.keywordFilter.includes(badword.toLowerCase())) {
                    return ctx.editOrReply(this.createEmbed(
                        'Word Already Filtered',
                        `The word \`${badword}\` is already in the filter.`,
                    ));
                }

                const updatedKeywords = [...rule.triggerMetadata.keywordFilter, badword.toLowerCase()];
                await rule.edit({
                    triggerMetadata: {
                        keywordFilter: updatedKeywords,
                    },
                });

                return ctx.editOrReply(this.createEmbed(
                    'Word Added to Filter',
                    `Successfully added \`${badword}\` to the filter.\n\nUse \`/badword list\` to see all filtered words.`,
                ));

            } catch (error: any) {
                return ctx.editOrReply(this.createEmbed(
                    'Error Adding Word',
                    `Failed to add word: ${error.message}\n\nPlease check that the bot has the required permissions.`,
                ));
            }
        }

        if (subCommand === 'remove') {
            let badword = ctx.options?.getString('word', true);
            if (!ctx.isInteraction) badword = ctx.args.slice(1).join(' ');

            if (!badword) {
                return ctx.editOrReply(this.createEmbed(
                    'Missing Word',
                    'Please specify a word to remove from the filter.',
                ));
            }

            const guild = await ctx.client.guilds.fetch(ctx.guild.id);
            const rules = await guild.autoModerationRules.fetch();
            const rule = rules.find(r => r.name === 'soward badwords');

            try {
                if (!rule) {
                    return ctx.editOrReply(this.createEmbed(
                        'No Filter Active',
                        'There is no word filter active on this server.',
                    ));
                }

                if (!rule.triggerMetadata.keywordFilter.includes(badword.toLowerCase())) {
                    return ctx.editOrReply(this.createEmbed(
                        'Word Not Found',
                        `The word \`${badword}\` is not in the filter.\n\nUse \`/badword list\` to see all filtered words.`,
                    ));
                }

                const updatedKeywords = rule.triggerMetadata.keywordFilter.filter(word => word !== badword.toLowerCase());

                if (updatedKeywords.length === 0) {
                    await rule.delete();
                    return ctx.editOrReply(this.createEmbed(
                        'Filter Removed',
                        `Removed the last word (\`${badword}\`) and disabled the filter.\n\nThe filter will be recreated when you add a new word.`,
                    ));
                }

                await rule.edit({
                    triggerMetadata: {
                        keywordFilter: updatedKeywords,
                    },
                });

                return ctx.editOrReply(this.createEmbed(
                    'Word Removed',
                    `Successfully removed \`${badword}\` from the filter.\n\n${updatedKeywords.length} word${updatedKeywords.length !== 1 ? 's' : ''} still filtered.`,
                ));

            } catch (error: any) {
                return ctx.editOrReply(this.createEmbed(
                    'Error Removing Word',
                    `Failed to remove word: ${error.message}`,
                ));
            }
        }

        if (subCommand === 'list') {
            try {
                const guild = await ctx.client.guilds.fetch(ctx.guild.id);
                const rules = await guild.autoModerationRules.fetch();
                const rule = rules.find(r => r.name === 'soward badwords');

                if (!rule || rule.triggerMetadata.keywordFilter.length === 0) {
                    return ctx.editOrReply(this.createEmbed(
                        'No Filtered Words',
                        'There are no words currently being filtered.\n\nAdd words with `/badword add <word>`.',
                    ));
                }

                const words = rule.triggerMetadata.keywordFilter;
                const wordCount = words.length;

                const fields: { name: string; value: string }[] = [];
                if (words.length > 0) {
                    // Split into chunks of 15 words to avoid exceeding message limits
                    const chunks = [];
                    for (let i = 0; i < words.length; i += 15) {
                        chunks.push(words.slice(i, i + 15));
                    }

                    chunks.forEach((chunk, index) => {
                        fields.push({
                            name: index === 0 ? 'Words' : 'More Words',
                            value: chunk.map(w => `\`${w}\``).join(', '),
                        });
                    });
                }

                return ctx.editOrReply(this.createEmbed(
                    'Filtered Words',
                    `Currently filtering **${wordCount}** word${wordCount !== 1 ? 's' : ''}.\n\n*Use \`/badword remove <word>\` to remove specific words.*`,
                    undefined,
                    fields,
                ));

            } catch (error: any) {
                return ctx.editOrReply(this.createEmbed(
                    'Error',
                    `Failed to list words: ${error.message}`,
                ));
            }
        }

        if (subCommand === 'clear') {
            try {
                const guild = await ctx.client.guilds.fetch(ctx.guild.id);
                const rules = await guild.autoModerationRules.fetch();
                const rule = rules.find(r => r.name === 'soward badwords');

                if (!rule || rule.triggerMetadata.keywordFilter.length === 0) {
                    return ctx.editOrReply(this.createEmbed(
                        'No Filtered Words',
                        'There are no words currently being filtered.',
                    ));
                }

                const wordCount = rule.triggerMetadata.keywordFilter.length;

                const confirmMsg = this.createEmbed(
                    'Confirm Clear Filter',
                    `Are you sure you want to remove **all ${wordCount} filtered words**?\n\nThis action cannot be undone.`,
                );

                // For interaction commands, we can use buttons
                if (ctx.isInteraction) {
                    const buttons = this.createConfirmationButtons();
                    const response = await ctx.editOrReply({
                        components: [...confirmMsg.components, buttons],
                        flags: confirmMsg.flags,
                    });

                    try {
                        const confirmation = await response.awaitMessageComponent({
                            filter: i => i.user.id === ctx.author?.id,
                            time: 30000
                        });

                        if (confirmation.customId === 'confirm_clear') {
                            await rule.delete();

                            const successMsg = this.createEmbed(
                                'Filter Cleared',
                                `Successfully removed all ${wordCount} filtered words.\n\nYou can add new words with \`/badword add <word>\`.`,
                            );

                            await confirmation.update({
                                components: successMsg.components,
                                flags: successMsg.flags,
                            });
                        } else {
                            const cancelMsg = this.createEmbed(
                                'Action Cancelled',
                                'Word filter clear operation cancelled.',
                            );

                            await confirmation.update({
                                components: cancelMsg.components,
                                flags: cancelMsg.flags,
                            });
                        }
                    } catch (error) {
                        // Button timed out
                        const timeoutMsg = this.createEmbed(
                            'Action Cancelled',
                            'Confirmation timed out. No changes were made to the filter.',
                        );

                        await response.edit({
                            components: timeoutMsg.components,
                            flags: timeoutMsg.flags,
                        });
                    }
                } else {
                    // For text commands, just clear immediately
                    await rule.delete();

                    return ctx.editOrReply(this.createEmbed(
                        'Filter Cleared',
                        `Successfully removed all ${wordCount} filtered words.\n\nYou can add new words with \`/badword add <word>\`.`,
                    ));
                }
            } catch (error: any) {
                return ctx.editOrReply(this.createEmbed(
                    'Error',
                    `Failed to clear words: ${error.message}`,
                ));
            }
        }
    }
}
