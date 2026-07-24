import { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ComponentType } from 'discord.js';
import type { SearchResult, Track } from 'lavalink-client';
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { isAllowedDirectMusicUrl } from "../../utils/musicSources";

export default class Search extends Command {
    constructor() {
        super({
            name: 'search',
            description: {
                content: 'Search for a song and select from results',
                examples: ['search Never Gonna Give You Up'],
                usage: 'search <song>',
            },
            category: 'music',
            aliases: ['sc'],
            cooldown: 5,
            args: true,
            vote: true,
            player: {
                voice: true,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [
                {
                    name: 'song',
                    description: 'The song to search for',
                    type: 3, // STRING type
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context, args: string[]): Promise<any> {
        const embed = new EmbedBuilder().setColor(ctx.client.config.colors.main);
        const query = args.join(' ');
		if (!isAllowedDirectMusicUrl(query)) {
			return ctx.sendMessage("That direct URL is not an approved music provider. Upload files with `/playfile`.");
		}

        const availableNodes = [...ctx.client.manager.nodeManager.nodes.values()].filter(n => n.connected);
        if (availableNodes.length === 0) {
            return ctx.sendMessage("-# Music is currently unavailable — the audio server is offline. Please try again later.");
        }

        const memberVoiceChannel = ctx.member?.voice.channel;

        if (!memberVoiceChannel) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "You need to be in a voice channel to use this command",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        let player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            player = ctx.client.manager.createPlayer({
                guildId: ctx.guild!.id,
                voiceChannelId: memberVoiceChannel.id,
                textChannelId: ctx.channel.id,
                selfMute: false,
                selfDeaf: true,
            });
        }

        if (!player.connected) await player.connect();

        const response = await player.search({ query }, ctx.author) as SearchResult;

        if (!response || !response.tracks?.length) {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setDescription("No results found for your search")
                        .setColor(ctx.client.config.colors.red)
                ],
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-track')
            .setPlaceholder('Select a track to play')
            .addOptions(
                response.tracks.slice(0, 10).map((track: Track, index: number) => ({
                    label: `${index + 1}. ${track.info.title.slice(0, 90)}`,
                    description: track.info.author?.slice(0, 50) || 'Unknown artist',
                    value: index.toString(),
                }))
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const tracksList = response.tracks
            .slice(0, 10)
            .map((track, index) => `${index + 1}. [${track.info.title}](${track.info.uri}) - \`${track.info.author}\``)
            .join('\n');

        const searchMessage = await ctx.sendMessage({
            embeds: [
                embed
                    .setDescription(`**Search Results**\n${tracksList}`)
                    .setFooter({ text: "You have 60 seconds to select a track" })
            ],
            components: [row],
        });

        const collector = searchMessage.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === ctx.author?.id,
            time: 60000,
        });

        collector.on('collect', async interaction => {
            await interaction.deferUpdate();
            const selectedTrack = response.tracks[Number.parseInt(interaction.values[0]!, 10)];

            if (!selectedTrack) return;

            player.queue.add(selectedTrack);
            if (!player.playing && !player.paused) await player.play();

            await searchMessage.edit({
                embeds: [
                    embed
                        .setDescription(`Added [${selectedTrack.info.title}](${selectedTrack.info.uri}) to the queue`)
                        .setColor(ctx.client.config.colors.main)
                ],
                components: [],
            });

            collector.stop();
        });

        collector.on('end', async () => {
            try {
                await searchMessage.edit({ components: [] });
            } catch (_error) {
                // Message might already be deleted
            }
        });
    }
}
