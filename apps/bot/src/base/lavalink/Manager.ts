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
                // Retry indefinitely — Railway and similar proxies drop idle
                // WebSockets (code 1006). We must keep retrying until the node
                // comes back rather than giving up after a handful of attempts.
                retryAmount: node.retryAmount ?? Infinity,
                // Wait 5 s between retries so the proxy/server has time to
                // accept a new connection instead of being flooded.
                retryDelay: node.retryDelay ?? 5_000,
                // Must cover at least retryDelay * retryAmount window.
                // Set high enough (1 hour) so retries are never considered stale.
                retryTimespan: 3_600_000,
                requestSignalTimeoutMS: node.requestSignalTimeoutMS ?? 10_000,
                // Send a WebSocket ping every 30 s to keep the proxy alive and
                // detect silent drops before they become code-1006 disconnects.
                heartBeatInterval: node.heartBeatInterval ?? 15_000,
                // Also ping via the Lavalink /stats endpoint to confirm the node
                // is alive beyond just the WebSocket layer.
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
