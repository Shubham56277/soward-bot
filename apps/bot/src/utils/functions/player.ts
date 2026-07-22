import { Player, Track } from "lavalink-client";

export interface Requester {
    id: string;
    username: string;
    avatarURL?: string;
    discriminator?: string;
}
export const requesterTransformer = (requester: any): Requester => {
	if (requester && typeof requester === "object") {
		const nested = requester.id && typeof requester.id === "object" ? requester.id : requester;
		const id = typeof nested.id === "string" ? nested.id : typeof requester.id === "string" ? requester.id : "unknown";
		const username =
			[requester.username, requester.globalName, requester.displayName, nested.username]
				.find((value) => typeof value === "string" && value.trim() && value !== "[object Object]") || "Unknown user";
		const avatarURL =
			typeof requester.displayAvatarURL === "function"
				? requester.displayAvatarURL({ extension: "png" })
				: typeof requester.avatarURL === "string"
					? requester.avatarURL
					: undefined;

		return {
			id,
			username,
			avatarURL,
			discriminator: typeof requester.discriminator === "string" ? requester.discriminator : undefined,
		};
	}

	return { id: typeof requester === "string" ? requester : "unknown", username: "Unknown user" };
};

/**
 * Function that will be called when the autoplay feature is enabled and the queue
 * is empty. It will search for tracks based on the last played track and add them
 * to the queue.
 *
 * @param {Player} player The player instance.
 * @param {Track} lastTrack The last played track.
 * @returns {Promise<void>} A promise that resolves when the function is done.
 */
export async function autoPlayFunction(player: Player, lastTrack?: Track): Promise<void> {
    if (!player.get('autoplay')) return;
    if (!lastTrack) return;

    if (lastTrack.info.sourceName === 'spotify') {
        const filtered = player.queue.previous.filter(v => v.info.sourceName === 'spotify').slice(0, 5);
        const ids = filtered.map(
            v => v.info.identifier || v.info.uri.split('/')?.reverse()?.[0] || v.info.uri.split('/')?.reverse()?.[1],
        );
        if (ids.length >= 2) {
            const res = await player
                .search(
                    {
                        query: `seed_tracks=${ids.join(',')}`, //`seed_artists=${artistIds.join(",")}&seed_genres=${genre.join(",")}&seed_tracks=${trackIds.join(",")}`;
                        source: 'sprec',
                    },
                    lastTrack.requester,
                )
                .then((response: any) => {
                    response.tracks = response.tracks.filter(
                        (v: { info: { identifier: string } }) => v.info.identifier !== lastTrack.info.identifier,
                    ); // remove the lastPlayed track if it's in there..
                    return response;
                })
                .catch(console.warn);
            if (res && res.tracks.length > 0)
                await player.queue.add(
                    res.tracks.slice(0, 5).map((track: { pluginInfo: { clientData: any } }) => {
                        // transform the track plugininfo so you can figure out if the track is from autoplay or not.
                        track.pluginInfo.clientData = { ...(track.pluginInfo.clientData || {}), fromAutoplay: true };
                        return track;
                    }),
                );
        }
        return;
    }
    if (lastTrack.info.sourceName === 'youtube' || lastTrack.info.sourceName === 'youtubemusic') {
        const res = await player
            .search(
                {
                    query: `https://www.youtube.com/watch?v=${lastTrack.info.identifier}&list=RD${lastTrack.info.identifier}`,
                    source: 'youtube',
                },
                lastTrack.requester,
            )
            .then((response: any) => {
                response.tracks = response.tracks.filter(
                    (v: { info: { identifier: string } }) => v.info.identifier !== lastTrack.info.identifier,
                ); // remove the lastPlayed track if it's in there..
                return response;
            })
            .catch(console.warn);
        if (res && res.tracks.length > 0)
            await player.queue.add(
                res.tracks.slice(0, 5).map((track: { pluginInfo: { clientData: any } }) => {
                    // transform the track plugininfo so you can figure out if the track is from autoplay or not.
                    track.pluginInfo.clientData = { ...(track.pluginInfo.clientData || {}), fromAutoplay: true };
                    return track;
                }),
            );
        return;
    }
    if (lastTrack.info.sourceName === 'jiosaavn') {
        const res = await player.search(
            { query: `jsrec:${lastTrack.info.identifier}`, source: 'jsrec' },
            lastTrack.requester,
        );
        if (res.tracks.length > 0) {
            const track = res.tracks.filter(v => v.info.identifier !== lastTrack.info.identifier)[0];
            await player.queue.add(track as Track);
        }
    }
    return;
}
