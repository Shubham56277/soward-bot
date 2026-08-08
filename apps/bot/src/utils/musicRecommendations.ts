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
		// Clean up the title before searching — SoundCloud titles often have
		// noise like ".mp3", "(Official Audio)", "[Lyrics]", etc.
		const cleanTitle = (track.info.title ?? "")
			.replace(/\.(mp3|wav|m4a|flac|ogg)$/i, "")
			.replace(/\(.*?\)/g, "")
			.replace(/\[.*?\]/g, "")
			.replace(/\bofficial\b/gi, "")
			.replace(/\baudio\b/gi, "")
			.replace(/\blyrics?\b/gi, "")
			.replace(/\bvideo\b/gi, "")
			.replace(/[-–—|]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		const cleanAuthor = (track.info.author ?? "")
			.replace(/[-–—|]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		// Build a clean search query — just the core song identity
		const searchQuery = `${cleanTitle} ${cleanAuthor}`.trim();
		if (searchQuery.length < 3) return [];

		const result = await player.search({ query: searchQuery, source: "scsearch" }, track.requester);

		const resolvedTracks = (result?.tracks || []).filter((candidate) =>
			typeof candidate.info.identifier === "string" &&
			typeof candidate.info.duration === "number" &&
			candidate.info.duration > 30_000 &&
			!/\.(mp3|wav|m4a|flac)$/i.test(candidate.info.title ?? ""),
		) as Track[];

		const recommendations = usableTracks(resolvedTracks, track);
		if (recommendations.length) await redis.setex(cacheKey(player, track), CACHE_SECONDS, JSON.stringify(recommendations));
		return recommendations;
	} catch {
		return [];
	}
}
