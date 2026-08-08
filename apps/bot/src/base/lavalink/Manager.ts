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
                retryAmount: node.retryAmount ?? Infinity,
                retryDelay: node.retryDelay ?? 3_000,
                retryTimespan: 3_600_000,
                requestSignalTimeoutMS: node.requestSignalTimeoutMS ?? 10_000,
                heartBeatInterval: node.heartBeatInterval ?? 30_000,
                enablePingOnStatsCheck: node.enablePingOnStatsCheck ?? true,
                closeOnError: node.closeOnError ?? false,
                // Session resume: lavalink-client sends the session ID on reconnect
                // so Lavalink server can restore players without re-creating them.
                // Requires Lavalink server v4+ with session resume enabled.
                sessionId: (node as any).sessionId ?? undefined,
            })) as LavalinkNodeOptions[],
            sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
            queueOptions: {
                maxPreviousTracks: 25,
            },
            playerOptions: {
                defaultSearchPlatform: "scsearch",
                onDisconnect: {
                    autoReconnect: true,
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
