import { EmbedBuilder, MessageFlags, VoiceChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SearchResult } from "lavalink-client";
import { isAllowedDirectMusicUrl } from "../../utils/musicSources";
import { createQueueAddedPanel } from "../../utils/musicPanel";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
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
			return ctx.sendMessage("That direct URL is not an approved music provider. Use YouTube, Spotify, SoundCloud, Apple Music, or `/playfile` for a Discord upload.");
		}
        await ctx.sendDeferMessage("-# Searching for your song...");
        let player = client.manager.getPlayer(ctx.guild!.id);
        const memberVoiceChannel = (ctx.member as any).voice.channel as VoiceChannel;
        const embed = new EmbedBuilder().setTimestamp().setFooter({
            text: `Requested by ${ctx.author?.username}`,
            iconURL: ctx.author?.displayAvatarURL(),
        });

        if (!player)
            player = client.manager.createPlayer({
                guildId: ctx.guild!.id,
                voiceChannelId: memberVoiceChannel.id,
                textChannelId: ctx.channel.id,
                selfMute: false,
                selfDeaf: true,
                vcRegion: memberVoiceChannel.rtcRegion!,
            });

        let response: SearchResult;
        try {
            const [searchResult] = await Promise.all([
                withTimeout(player.search({ query }, ctx.author), 10_000, "Song search"),
                player.connected ? Promise.resolve() : withTimeout(player.connect(), 10_000, "Voice connection"),
            ]);
            response = searchResult as SearchResult;
        } catch (error) {
            client.logger.error("[play] Failed to search or connect to voice", error);
            return await ctx.editMessage({
                content: '',
                embeds: [
                    embed
                        .setColor(client.config.colors.red)
                        .setDescription("I couldn't connect or find that song in time. Please try again."),
                ],
            });
        }

        if (!response || response.tracks?.length === 0) {
            return await ctx.editMessage({
                content: '',
                embeds: [embed.setColor(client.config.colors.red).setDescription("No results found.")],
            });
        }

        const isPlaylist = response.loadType === 'playlist';
        const track = response.tracks[0];
        await player.queue.add(isPlaylist ? response.tracks! : track!);

        if (isPlaylist) {
			embed.setColor(client.config.colors.main);
            embed.setAuthor({ name: "Playlist Added" });
            embed.setDescription(`Successfully added ${response.tracks.length} tracks to the queue.`);
			await ctx.editMessage({ content: "", embeds: [embed] });
        } else {
			await ctx.editMessage({
				content: "",
				embeds: [],
				components: [createQueueAddedPanel(track!, client.config.colors.main)],
				flags: MessageFlags.IsComponentsV2,
			});
        }

        if (!player.playing && player.queue.tracks.length > 0) {
            await player.play({ paused: false });
        }
    }
    /*  public async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
         const focusedValue = interaction.options.getFocused(true);
 
         if (!focusedValue?.value.trim()) {
             return interaction.respond([]);
         }
 
         const res = await this.client.manager.search(focusedValue.value.trim(), interaction.user);
         const songs: ApplicationCommandOptionChoiceData[] = [];
 
         if (res.loadType === 'search') {
             res.tracks.slice(0, 10).forEach(track => {
                 const name = `${track.info.title} by ${track.info.author}`;
                 songs.push({
                     name: name.length > 100 ? `${name.substring(0, 97)}...` : name,
                     value: track.info.uri,
                 });
             });
         }
 
         return await interaction.respond(songs);
     } */
}
