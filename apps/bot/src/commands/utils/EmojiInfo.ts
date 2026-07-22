import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder, Colors, GuildEmoji, User } from "discord.js";
import { Pagination } from "../../utils/Pagination";

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

        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`Emoji Info: ${emoji.name}`)
            .setThumbnail(emoji.url)
            .addFields([
                { name: 'ID', value: emoji.id, inline: true },
                { name: 'Animated', value: emoji.animated ? '<:Tick:1375519268292264012> Yes' : '<:Cross:1375519752746958858> No', inline: true },
                { name: 'Created', value: `<t:${Math.floor(emoji.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Identifier', value: `\`${emoji.identifier}\``, inline: true },
                { name: 'Available', value: emoji.available ? '<:Tick:1375519268292264012> Yes' : '<:Cross:1375519752746958858> No', inline: true }
            ]);

        if (creator) {
            embed.addFields([
                { name: 'Created By', value: `${creator} (${creator.tag})`, inline: true }
            ]);
        }

        if (emoji.roles.cache.size > 0) {
            embed.addFields([{
                name: 'Restricted to Roles',
                value: emoji.roles.cache.map(r => r.toString()).join(', '),
                inline: false
            }]);
        }

        embed.addFields([
            { name: 'URL', value: `[Download](${emoji.url})`, inline: true }
        ]);

        if (creator) {
            embed.setFooter({
                text: `Created by ${creator.tag}`,
                iconURL: creator.displayAvatarURL()
            });
        }

        return ctx.sendMessage({ embeds: [embed] });
    }

    private async listEmojis(ctx: Context): Promise<any> {
        const emojis = ctx.guild.emojis.cache;
        if (emojis.size === 0) {
            return ctx.sendMessage('This server has no custom emojis.');
        }

        // Fetch creators for all emojis (if permission available)
        const emojisWithCreators = await this.fetchEmojiCreators(ctx, [...emojis.values()]);

        const emojiChunks = this.chunkArray(emojisWithCreators, 10);
        const embeds = emojiChunks.map((chunk, i) => {
            const embed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setTitle(`Server Emojis (${emojis.size})`)
                .setDescription(
                    chunk.map(e => {
                        let info = `${e.emoji} \`:${e.emoji.name}:\``;
                        if (e.creator) info += ` - Added by ${e.creator.username}`;
                        return info;
                    }).join('\n')
                )
                .setFooter({ text: `Page ${i + 1}/${emojiChunks.length}` });

            return embed;
        });

        if (embeds.length === 1) {
            return ctx.sendMessage({ embeds: [embeds[0]!] });
        }

        const pagination = new Pagination(ctx, embeds);
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