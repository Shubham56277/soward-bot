import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, GuildEmoji, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, User } from "discord.js";
import { ContainerPagination } from "../../utils/Pagination";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class EmojiInfo extends Command {
    constructor() {
        super({
            name: 'emojiinfo',
            description: {
                content: 'Get detailed information about server emojis including creator',
                examples: [
                    'emojiinfo :emoji:',
                    'emojiinfo list'
                ],
                usage: 'emojiinfo <emoji|list>',
            },
            category: 'utils',
            aliases: ['emojinfo', 'emoji'],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'emoji',
                    description: 'Get info about a specific emoji',
                    type: 3, // String
                    required: false
                },
                {
                    name: 'list',
                    description: 'List all server emojis with creators',
                    type: 5, // Boolean
                    required: false
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const emojiArg = ctx.args[0] || ctx.interaction?.options.getString('emoji');
        const listFlag = ctx.args[0] === 'list' || ctx.interaction?.options.getBoolean('list');

        if (listFlag) {
            return this.listEmojis(ctx);
        }

        if (emojiArg) {
            return this.showEmojiInfo(ctx, emojiArg);
        }

        return ctx.sendMessage('Please specify an emoji or use `list` to see all emojis');
    }

    private async showEmojiInfo(ctx: Context, emojiInput: string): Promise<any> {
        let emoji: GuildEmoji | undefined;
        const emojiId = emojiInput.match(/<a?:[a-zA-Z0-9_]+:(\d+)>/)?.[1];

        const guildEmojis = ctx.guild.emojis.cache;
        if (guildEmojis.size === 0) {
            await ctx.guild.emojis.fetch();
        }
        if (emojiId) {
            emoji = ctx.guild.emojis.cache.get(emojiId);
        } else {
            emoji = ctx.guild.emojis.cache.find(e =>
                e.name === emojiInput ||
                e.id === emojiInput ||
                `:${e.name}:` === emojiInput
            );
        }

        if (!emoji) {
            return ctx.sendMessage('Emoji not found in this server.');
        }

        // Fetch the creator if available (requires MANAGE_EMOJIS permission)
        let creator: User | null = null;
        try {
            if (ctx.guild.members.me?.permissions.has('ManageEmojisAndStickers')) {
                const fetchedEmoji = await ctx.guild.emojis.fetch(emoji.id);
                creator = fetchedEmoji.author;
            }
        } catch (error) {
            console.error('Failed to fetch emoji creator:', error);
        }

        const fields = [
            `**ID:** ${emoji.id}`,
            `**Animated:** ${emoji.animated ? '<:Tick:1375519268292264012> Yes' : '<:Cross:1375519752746958858> No'}`,
            `**Created:** <t:${Math.floor(emoji.createdTimestamp / 1000)}:R>`,
            `**Identifier:** \`${emoji.identifier}\``,
            `**Available:** ${emoji.available ? '<:Tick:1375519268292264012> Yes' : '<:Cross:1375519752746958858> No'}`,
            `**URL:** [Download](${emoji.url})`,
        ];

        if (creator) {
            fields.push(`**Created By:** ${creator} (${creator.tag})`);
        }

        if (emoji.roles.cache.size > 0) {
            fields.push(`**Restricted to Roles:** ${emoji.roles.cache.map(r => r.toString()).join(', ')}`);
        }

        const panel = buildPanel(`Emoji Info: ${emoji.name}`, fields.join("\n") + (creator ? `\n\n-# Created by ${creator.tag}` : ""));
        return ctx.sendMessage({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }

    private async listEmojis(ctx: Context): Promise<any> {
        const emojis = ctx.guild.emojis.cache;
        if (emojis.size === 0) {
            return ctx.sendMessage('This server has no custom emojis.');
        }

        // Fetch creators for all emojis (if permission available)
        const emojisWithCreators = await this.fetchEmojiCreators(ctx, [...emojis.values()]);

        const emojiChunks = this.chunkArray(emojisWithCreators, 10);
        const pages = emojiChunks.map((chunk, i) => {
            const body = chunk.map(e => {
                let info = `${e.emoji} \`:${e.emoji.name}:\``;
                if (e.creator) info += ` - Added by ${e.creator.username}`;
                return info;
            }).join('\n') + `\n\n-# Page ${i + 1}/${emojiChunks.length}`;
            return buildPanel(`Server Emojis (${emojis.size})`, body);
        });

        if (pages.length === 1) {
            return ctx.sendMessage({ components: [pages[0]!], flags: MessageFlags.IsComponentsV2 });
        }

        const pagination = new ContainerPagination(ctx, pages);
        return pagination.start();
    }

    private async fetchEmojiCreators(ctx: Context, emojis: GuildEmoji[]): Promise<{ emoji: GuildEmoji, creator: User | null }[]> {
        const results = [];

        if (!ctx.guild.members.me?.permissions.has('ManageEmojisAndStickers')) {
            return emojis.map(e => ({ emoji: e, creator: null }));
        }

        for (const emoji of emojis) {
            try {
                const fetchedEmoji = await ctx.guild.emojis.fetch(emoji.id);
                results.push({
                    emoji,
                    creator: fetchedEmoji.author
                });
            } catch (error) {
                console.error(`Failed to fetch creator for emoji ${emoji.id}:`, error);
                results.push({
                    emoji,
                    creator: null
                });
            }
        }

        return results;
    }

    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
}