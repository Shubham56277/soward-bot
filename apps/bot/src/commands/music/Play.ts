import { MessageFlags, VoiceChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SearchResult } from "lavalink-client";
import { isAllowedDirectMusicUrl } from "../../utils/musicSources";
import { createQueueAddedPanel } from "../../utils/musicPanel";

function isUrl(query: string): boolean {
    return /^https?:\/\//i.test(query);
}

export default class Play extends Command {
    constructor() {
        super({
            name: 'play',
            description: {
                content: 'Play a song',
                examples: [
                    'play never gonna give you up',
                    'play https://www.youtube.com/watch?v=example',
                    'play https://open.spotify.com/track/example',
                ],
                usage: 'play <song>',
            },
            category: 'music',
            aliases: ['p'],
            cooldown: 5,
            args: true,
            vote: false,
            player: {
                voice: true,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
                user: [],
            },
            slashCommand: false,
            options: [
                {
                    name: 'query',
                    description: 'Enter a song name or url',
                    type: 3,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }

    public async run(ctx: Context, args: string[]): Promise<any> {
        const query = args.join(' ');
        const { client } = ctx;

        if (!isAllowedDirectMusicUrl(query)) {
            return ctx.sendMessage("-# That URL is not from an approved music provider.");
        }

        let player = client.manager.getPlayer(ctx.guild!.id);
        const memberVoiceChannel = (ctx.member as any)?.voice?.channel as VoiceChannel | undefined;

        if (!memberVoiceChannel) {
            return ctx.sendMessage("-# You need to be in a voice channel.");
        }

        if (!player) {
            player = client.manager.createPlayer({
                guildId: ctx.guild!.id,
                voiceChannelId: memberVoiceChannel.id,
                textChannelId: ctx.channel.id,
                selfMute: false,
                selfDeaf: true,
                vcRegion: memberVoiceChannel.rtcRegion!,
            });
        }

        let response: SearchResult;
        try {
            // Connect if not already connected
            if (!player.connected) {
                await player.connect();
            }

            // URLs are loaded directly by Lavalink; text queries use YouTube search only.
            if (isUrl(query)) {
                response = await player.search({ query }, ctx.author) as SearchResult;
            } else {
                response = await player.search({ query, source: "ytsearch" }, ctx.author) as SearchResult;
            }
        } catch (error) {
            client.logger.error("[play] Search/connect failed", error);
            return ctx.sendMessage("-# Couldn't find or play that song. Please try again.");
        }

        if (!response || response.tracks?.length === 0) {
            return ctx.sendMessage("-# No results found.");
        }

        try {
            const isPlaylist = response.loadType === 'playlist';
            const track = response.tracks[0];
            await player.queue.add(isPlaylist ? response.tracks! : track!);

            if (isPlaylist) {
                await ctx.sendMessage(`-# Added **${response.tracks.length}** tracks from playlist to the queue.`);
            } else {
                await ctx.sendMessage({
                    components: [createQueueAddedPanel(track!)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            if (!player.playing && player.queue.tracks.length > 0) {
                await player.play({ paused: false });
            }
        } catch (error) {
            client.logger.error("[play] Queue/play failed", error);
            return ctx.sendMessage("-# Something went wrong while trying to play. Please try again.");
        }
    }
}
