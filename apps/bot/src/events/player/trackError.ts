import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { TextChannel } from "discord.js";
import type { Track } from "lavalink-client";

// Identifiers that already failed — avoid infinite retry loops
const recentlyFailed = new Map<string, number>();
const FAILURE_TTL_MS = 5 * 60_000;

function markFailed(id: string) {
    recentlyFailed.set(id, Date.now());
    setTimeout(() => recentlyFailed.delete(id), FAILURE_TTL_MS);
}

function hasFailed(id: string): boolean {
    return recentlyFailed.has(id);
}

async function retryWithFallback(
    client: BaseClient,
    player: any,
    track: Track,
    reason: string,
): Promise<void> {
    const guildId: string = player.guildId;
    const channel = player.textChannelId
        ? (client.guilds.cache.get(guildId)?.channels.cache.get(player.textChannelId) as TextChannel | undefined)
        : undefined;

    const id = track.info.identifier;
    const title = track.info.title ?? "Unknown";
    const author = track.info.author ?? "";

    client.logger.warn(`[trackError] "${title}" (${id}) failed — ${reason}`);
    markFailed(id);

    // Decide fallback source: if it came from SoundCloud try Apple Music, otherwise try SoundCloud
    const failedSource = track.info.sourceName;
    const fallbackSource = failedSource === "soundcloud" ? "amsearch" : "scsearch";
    const fallbackLabel  = fallbackSource === "scsearch" ? "SoundCloud" : "Apple Music";

    client.logger.debug(`[trackError] Trying fallback "${fallbackSource}" for "${title} ${author}"`);

    try {
        const res = await player.search(
            { query: `${fallbackSource}:${title} ${author}`.trim(), source: fallbackSource },
            track.requester,
        );

        const candidate = res?.tracks?.find((t: Track) => !hasFailed(t.info.identifier));
        if (!candidate) throw new Error("No valid fallback track found");

        // Insert fallback at front of queue
        await player.queue.splice(0, 0, candidate);
        if (!player.playing) await player.play({ paused: false });

        client.logger.debug(`[trackError] Fallback queued: "${candidate.info.title}" from ${fallbackLabel}`);

        await channel?.send(
            `-# Couldn't play **${title.slice(0, 80)}**. Now playing from **${fallbackLabel}** instead.`,
        ).catch(() => undefined);
    } catch (err: any) {
        client.logger.warn(`[trackError] Fallback also failed: ${err?.message ?? err}`);
        await channel?.send(
            `-# Couldn't play **${title.slice(0, 80)}** from any available source.`,
        ).catch(() => undefined);
    }
}

export default class TrackError extends Event {
    constructor(client: BaseClient) {
        super(client, { event: "trackError" });
    }

    public async execute(): Promise<void> {
        this.client.manager.on("trackError", async (player, track, payload) => {
            if (!track) return;
            const reason = payload?.exception?.message ?? "playback error";
            await retryWithFallback(this.client, player, track, reason);
        });
    }
}
