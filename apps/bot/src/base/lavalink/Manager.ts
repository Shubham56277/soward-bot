import { env } from "@repo/env";
import { LavalinkManager, LavalinkNodeOptions, SearchPlatform, SearchResult } from "lavalink-client";
import BaseClient from "../Client";
import { autoPlayFunction, requesterTransformer } from "../../utils/functions/player";

export default class LavalinkClient extends LavalinkManager {
    public client: BaseClient;
    constructor(client: BaseClient) {
        super({
            nodes: env.NODES.map(node => ({
                ...node,
                // Retry indefinitely so the bot reconnects after any transient
                // network blip or Lavalink restart without manual intervention.
                retryAmount: node.retryAmount ?? Infinity,
                // Direct connection (Azure VM) — 3s between retries is fast enough
                // without flooding the server on repeated failures.
                retryDelay: node.retryDelay ?? 3_000,
                // Window for retry tracking — 1 hour ensures retries never expire.
                retryTimespan: 3_600_000,
                requestSignalTimeoutMS: node.requestSignalTimeoutMS ?? 10_000,
                // Heartbeat every 30s — direct connections are stable, no proxy
                // timeout to worry about. Just enough to detect silent TCP drops.
                heartBeatInterval: node.heartBeatInterval ?? 30_000,
                // Ping via /stats endpoint to verify node health beyond WebSocket.
                enablePingOnStatsCheck: node.enablePingOnStatsCheck ?? true,
                // Do not close the connection on a node error — let retries handle it.
                closeOnError: node.closeOnError ?? false,
            })) as LavalinkNodeOptions[],
            sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
            queueOptions: {
                maxPreviousTracks: 25,
            },
            playerOptions: {
                defaultSearchPlatform: "scsearch",
                onDisconnect: {
                    // When the node comes back, automatically reconnect the
                    // player to the voice channel and resume playback.
                    autoReconnect: true,
                    // Only reconnect players that had something in the queue —
                    // avoids pointlessly reconnecting idle players.
                    autoReconnectOnlyWithTracks: true,
                    destroyPlayer: false,
                },
                requesterTransformer: requesterTransformer,
                onEmptyQueue: {
                    autoPlayFunction,
                },
            },
        });
        this.client = client;
    }
    /**
     * Searches for a song and returns the tracks.
     * @param query The query to search for.
     * @param user The user who requested the search.
     * @param source The source to search in. Defaults to youtube.
     * @returns An array of tracks that match the query.
     */
    public async search(query: string, user: unknown, source?: SearchPlatform): Promise<SearchResult> {
        const nodes = this.nodeManager.leastUsedNodes();
        const node = nodes[Math.floor(Math.random() * nodes.length)];
        if (!node) {
            throw new Error("No nodes available");
        }
        const result = await node.search({ query, source }, user, false);
        return result;
    }
}
