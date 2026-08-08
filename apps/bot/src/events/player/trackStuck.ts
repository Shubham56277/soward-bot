import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { TextChannel } from "discord.js";
import type { Track } from "lavalink-client";

// Prevent repeated stuck retries for the same track
const recentlyStuck = new Map<string, number>();
const STUCK_TTL_MS = 3 * 60_000;

export default class TrackStuck extends Event {
    constructor(client: BaseClient) {
        super(client, { event: "trackStuck" });
    }

    public async execute(): Promise<void> {
        this.client.manager.on("trackStuck", (player, track, payload) => {
            if (!track) return;
            void this.recover(player, track, payload).catch((error) => {
                this.client.logger.error(`[trackStuck] Recovery failed for guild ${player.guildId}`, error);
            });
        });
    }

    private async recover(player: any, track: Track, payload: any): Promise<void> {

            const id = track.info.identifier;
            const title = track.info.title ?? "Unknown";
            const author = track.info.author ?? "";
            const stuckFor = payload?.thresholdMs ?? 0;

            this.client.logger.warn(
                `[trackStuck] "${title}" (${id}) stuck for ${stuckFor}ms — trying to recover`,
            );

            const channel = player.textChannelId
                ? (this.client.guilds.cache
                    .get(player.guildId)
                    ?.channels.cache.get(player.textChannelId) as TextChannel | undefined)
                : undefined;

            // If this identifier already got stuck recently, skip to next in queue
            if (recentlyStuck.has(id)) {
                this.client.logger.warn(`[trackStuck] "${title}" stuck again — skipping to next track`);
                try { await player.skip(); } catch {}
                return;
            }

            recentlyStuck.set(id, Date.now());
            setTimeout(() => recentlyStuck.delete(id), STUCK_TTL_MS).unref();

            // Try SoundCloud fallback (only source available)
            const fallbackSource = "scsearch";
            const fallbackLabel  = "SoundCloud";

            try {
                const res = await player.search(
                    { query: `${fallbackSource}:${title} ${author}`.trim(), source: fallbackSource },
                    track.requester,
                );

                const candidate = res?.tracks?.find(
                    (result: Track): result is Track => this.client.manager.utils.isTrack(result),
                );
                if (!candidate) throw new Error("No fallback found");

                // Remove stuck track and insert replacement
                await player.queue.splice(0, 0, candidate);
                await player.skip();

                this.client.logger.debug(
                    `[trackStuck] Replaced with "${candidate.info.title}" from ${fallbackLabel}`,
                );

                await channel?.send(
                    `-# Stream got stuck on **${title.slice(0, 80)}**. Switched to **${fallbackLabel}**.`,
                ).catch(() => undefined);
            } catch (err: any) {
                this.client.logger.warn(`[trackStuck] Recovery failed: ${err?.message ?? err}`);
                try { await player.skip(); } catch {}
                await channel?.send(
                    `-# Stream got stuck on **${title.slice(0, 80)}** and couldn't recover. Skipped.`,
                ).catch(() => undefined);
            }
    }
}
