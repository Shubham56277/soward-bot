import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { Player, Track } from "lavalink-client";

const CACHE_SECONDS = 15 * 60;
const MAX_RECOMMENDATIONS = 10;

function cacheKey(player: Player, track: Track): string {
	const id = createHash("sha1").update(`${track.info.sourceName}:${track.info.identifier}`).digest("hex");
	return `music:recommendations:${player.guildId}:${id}`;
}

function usableTracks(tracks: Track[], current: Track): Track[] {
	const seen = new Set([current.info.identifier]);
	return tracks.filter((track) => {
		if (!track?.info?.identifier || seen.has(track.info.identifier)) return false;
		seen.add(track.info.identifier);
		return true;
	}).slice(0, MAX_RECOMMENDATIONS);
}

export async function readMusicRecommendations(redis: Redis, player: Player, track: Track): Promise<Track[]> {
	const cached = await redis.get(cacheKey(player, track)).catch(() => null);
	if (!cached) return [];
	try {
		return JSON.parse(cached) as Track[];
	} catch {
		return [];
	}
}

export async function getMusicRecommendations(redis: Redis, player: Player, track: Track): Promise<Track[]> {
	const cached = await readMusicRecommendations(redis, player, track);
	if (cached.length) return cached;

	try {
		let result: any;
		if (track.info.sourceName === "youtube" || track.info.sourceName === "youtubemusic") {
			result = await player.search(
				{ query: `https://www.youtube.com/watch?v=${track.info.identifier}&list=RD${track.info.identifier}`, source: "youtube" },
				track.requester,
			);
		} else if (track.info.sourceName === "spotify") {
			const seeds = [track, ...player.queue.previous]
				.filter((item) => item.info.sourceName === "spotify")
				.map((item) => item.info.identifier)
				.filter(Boolean)
				.slice(0, 5);
			result = await player.search({ query: `seed_tracks=${seeds.join(",")}`, source: "sprec" }, track.requester);
		} else {
			result = await player.search({ query: `${track.info.title} ${track.info.author}`, source: "youtubemusic" }, track.requester);
		}

		const resolvedTracks = (result?.tracks || []).filter((candidate) => typeof candidate.info.identifier === "string" && typeof candidate.info.duration === "number") as Track[];
		const recommendations = usableTracks(resolvedTracks, track);
		if (recommendations.length) await redis.setex(cacheKey(player, track), CACHE_SECONDS, JSON.stringify(recommendations));
		return recommendations;
	} catch {
		return [];
	}
}
