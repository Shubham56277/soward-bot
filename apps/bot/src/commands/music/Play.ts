import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    VoiceChannel,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import type { SearchResult, Track } from "lavalink-client";
import { isAllowedDirectMusicUrl } from "../../utils/musicSources";
import { createQueueAddedPanel } from "../../utils/musicPanel";
import { TimeFormat } from "../../utils/timeFormat";

function isUrl(query: string): boolean {
    return /^https?:\/\//i.test(query);
}

function sourceLabel(sourceName: string): string {
    const map: Record<string, string> = {
        soundcloud:    "SoundCloud",
        applemusic:    "Apple Music",
        spotify:       "Spotify",
        youtubemusic:  "YouTube Music",
        youtube:       "YouTube",
        http:          "HTTP",
    };
    return map[sourceName] ?? sourceName;
}

function buildPickerPanel(
    scTracks: Track[],
    amTracks: Track[],
    query: string,
): ContainerBuilder {
    const lines: string[] = [];
    let idx = 0;

    if (scTracks.length) {
        lines.push("**SoundCloud results**");
        for (const t of scTracks.slice(0, 3)) {
            const dur = t.info.isStream ? "LIVE" : TimeFormat.toDotted(t.info.duration);
            lines.push(`**${idx + 1}.** ${t.info.title.slice(0, 70)} — ${(t.info.author ?? "").slice(0, 40)} \`${dur}\``);
            idx++;
        }
    }

    if (amTracks.length) {
        if (lines.length) lines.push("");
        lines.push("**Apple Music results**");
        for (const t of amTracks.slice(0, 3)) {
            const dur = t.info.isStream ? "LIVE" : TimeFormat.toDotted(t.info.duration);
            lines.push(`**${idx + 1}.** ${t.info.title.slice(0, 70)} — ${(t.info.author ?? "").slice(0, 40)} \`${dur}\``);
            idx++;
        }
    }

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### Results for "${query.slice(0, 60)}"\n\n${lines.join("\n")}`,
            ),
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "-# Pick a number to play it. Expires in 30 seconds.",
            ),
        );
}

function buildPickerButtons(total: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
    const btns = Array.from({ length: Math.min(total, 5) }, (_, i) =>
        new ButtonBuilder()
            .setCustomId(`play_pick_${i}`)
            .setLabel(String(i + 1))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
    );
    return new ActionRowBuilder<ButtonBuilder>().addComponents(...btns);
}

export default class Play extends Command {
    constructor() {
        super({
            name: "play",
            description: {
                content: "Play a song from SoundCloud or Apple Music",
                examples: ["play humsafar", "play never gonna give you up"],
                usage: "play <song name>",
            },
            category: "music",
            aliases: ["p"],
            cooldown: 5,
            args: true,
            vote: false,
            player: { voice: true, active: false },
            permissions: {
                dev: false,
                client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "Connect", "Speak"],
                user: [],
            },
            slashCommand: false,
            options: [
                {
                    name: "query",
                    description: "Song name or URL",
                    type: 3,
                    required: true,
                    autocomplete: true,
                },
            ],
        });
    }

    public async run(ctx: Context, args: string[]): Promise<any> {
        const query = args.join(" ").trim();
        const { client } = ctx;

        if (!isAllowedDirectMusicUrl(query)) {
            return ctx.sendMessage("-# That URL is not from an approved music provider.");
        }

        const availableNodes = [...client.manager.nodeManager.nodes.values()].filter(n => n.connected);
        if (availableNodes.length === 0) {
            return ctx.sendMessage("-# Music server is offline. Please try again in a moment.");
        }

        const memberVoice = (ctx.member as any)?.voice?.channel as VoiceChannel | undefined;
        if (!memberVoice) {
            return ctx.sendMessage("-# You need to be in a voice channel first.");
        }

        let player = client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            player = client.manager.createPlayer({
                guildId: ctx.guild!.id,
                voiceChannelId: memberVoice.id,
                textChannelId: ctx.channel.id,
                selfMute: false,
                selfDeaf: true,
                vcRegion: memberVoice.rtcRegion ?? undefined,
            });
        }

        try {
            if (!player.connected) await player.connect();
        } catch (err) {
            client.logger.error("[play] voice connect failed", err);
            return ctx.sendMessage("-# Could not connect to your voice channel.");
        }

        // ── Direct URL ────────────────────────────────────────────────────────
        if (isUrl(query)) {
            let res: SearchResult;
            try {
                res = await player.search({ query }, ctx.author) as SearchResult;
            } catch (err) {
                client.logger.error("[play] URL load failed", err);
                return ctx.sendMessage("-# Couldn't load that URL.");
            }
            if (!res?.tracks?.length) return ctx.sendMessage("-# Nothing found at that URL.");
            return this.queue(ctx, player, res);
        }

        // ── Search both sources in parallel ──────────────────────────────────
        const [scResult, amResult] = await Promise.allSettled([
            player.search({ query, source: "scsearch" }, ctx.author) as Promise<SearchResult>,
            player.search({ query, source: "amsearch" }, ctx.author) as Promise<SearchResult>,
        ]);

        const scTracks: Track[] = scResult.status === "fulfilled" ? (scResult.value?.tracks ?? []).slice(0, 3) : [];
        const amTracks: Track[] = amResult.status === "fulfilled" ? (amResult.value?.tracks ?? []).slice(0, 3) : [];

        if (scResult.status === "rejected") {
            client.logger.warn(`[play] SoundCloud search failed: ${(scResult.reason as any)?.message}`);
        }
        if (amResult.status === "rejected") {
            client.logger.warn(`[play] Apple Music search failed: ${(amResult.reason as any)?.message}`);
        }

        const allTracks = [...scTracks, ...amTracks];

        if (allTracks.length === 0) {
            return ctx.sendMessage("-# No results found. Try a different song name.");
        }

        // One result — queue it directly
        if (allTracks.length === 1) {
            client.logger.debug(`[play] Single result for "${query}" — auto-queuing`);
            return this.queueTrack(ctx, player, allTracks[0]!);
        }

        // Multiple results — show picker
        const panel = buildPickerPanel(scTracks, amTracks, query);
        const buttons = buildPickerButtons(allTracks.length);

        const msg = await ctx.sendMessage({
            components: [panel, buttons],
            flags: MessageFlags.IsComponentsV2,
        });

        const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i: ButtonInteraction) =>
                i.user.id === ctx.author?.id && i.customId.startsWith("play_pick_"),
            time: 30_000,
        });

        collector.on("collect", async (i: ButtonInteraction) => {
            const idx = Number.parseInt(i.customId.replace("play_pick_", ""), 10);
            const chosen = allTracks[idx];
            if (!chosen) return;

            collector.stop("selected");
            await i.deferUpdate().catch(() => undefined);
            await msg.edit({ components: [panel, buildPickerButtons(allTracks.length, true)] }).catch(() => undefined);
            await this.queueTrack(ctx, player!, chosen);
        });

        collector.on("end", async (_c, reason) => {
            if (reason !== "selected") {
                await msg.edit({ components: [panel, buildPickerButtons(allTracks.length, true)] }).catch(() => undefined);
                if (reason === "time") {
                    await ctx.sendMessage("-# Selection timed out. Run the command again.").catch(() => undefined);
                }
            }
        });
    }

    /** Queue a single Track object and start playback if idle */
    private async queueTrack(
        ctx: Context,
        player: NonNullable<ReturnType<typeof ctx.client.manager.getPlayer>>,
        track: Track,
    ): Promise<void> {
        try {
            const wasEmpty = !player.playing && player.queue.tracks.length === 0;
            await player.queue.add(track);
            ctx.client.logger.debug(
                `[play] Queued "${track.info.title}" from ${sourceLabel(track.info.sourceName)} (${track.info.identifier})`,
            );

            if (!wasEmpty) {
                await ctx.sendMessage({
                    components: [createQueueAddedPanel(track)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            if (wasEmpty && player.queue.tracks.length > 0) {
                await player.play({ paused: false });
            }
        } catch (err: any) {
            ctx.client.logger.error(`[play] queue/play failed: ${err?.message ?? err}`);
            await ctx.sendMessage("-# Something went wrong adding that track. Please try again.");
        }
    }

    /** Queue a full SearchResult (for URLs and playlists) */
    private async queue(
        ctx: Context,
        player: NonNullable<ReturnType<typeof ctx.client.manager.getPlayer>>,
        response: SearchResult,
    ): Promise<void> {
        try {
            const isPlaylist = response.loadType === "playlist";
            const track = response.tracks[0]!;
            const wasEmpty = !player.playing && player.queue.tracks.length === 0;

            await player.queue.add(isPlaylist ? response.tracks : track);

            if (isPlaylist) {
                await ctx.sendMessage(`-# Added **${response.tracks.length}** tracks from playlist.`);
            } else if (!wasEmpty) {
                await ctx.sendMessage({
                    components: [createQueueAddedPanel(track)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            if (wasEmpty && player.queue.tracks.length > 0) {
                await player.play({ paused: false });
            }
        } catch (err: any) {
            ctx.client.logger.error(`[play] URL queue failed: ${err?.message ?? err}`);
            await ctx.sendMessage("-# Something went wrong. Please try again.");
        }
    }
}
