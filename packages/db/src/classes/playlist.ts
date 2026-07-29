import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "..";
import { User } from "./user";

export interface PlaylistData {
	id: string;
	userId: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlaylistTrackData {
	id: string;
	playlistId: string;
	title: string | null;
	uri: string;
	author: string | null;
	duration: number | null;
	position: number;
	createdAt: Date;
}

export interface PlaylistTrackInput {
	title?: string | null;
	uri: string;
	author?: string | null;
	duration?: number | null;
}

/**
 * Personal (per-user) music playlists and their stored tracks.
 * Tracks are persisted by URI and re-resolved through Lavalink on playback.
 */
export class Playlist {
	/** Fetch a single playlist by owner and exact name. */
	public static async get(userId: string, name: string): Promise<PlaylistData | null> {
		const rows = await db
			.select()
			.from(schema.playlists)
			.where(and(eq(schema.playlists.userId, userId), eq(schema.playlists.name, name)))
			.limit(1)
			.execute();
		return rows[0] ?? null;
	}

	/** Every playlist owned by a user, oldest first. */
	public static async getAll(userId: string): Promise<PlaylistData[]> {
		return db.select().from(schema.playlists).where(eq(schema.playlists.userId, userId)).orderBy(asc(schema.playlists.createdAt)).execute();
	}

	/** Create an empty playlist. Returns null when the name is already taken. */
	public static async create(userId: string, name: string): Promise<PlaylistData | null> {
		await User.get(userId);
		const { nanoid } = await import("nanoid");
		const now = new Date();
		const rows = await db
			.insert(schema.playlists)
			.values({ id: nanoid(), userId, name, createdAt: now, updatedAt: now })
			.onConflictDoNothing()
			.returning()
			.execute();
		return rows[0] ?? null;
	}

	/** Delete a playlist (tracks cascade). Returns whether a playlist was removed. */
	public static async delete(userId: string, name: string): Promise<boolean> {
		const rows = await db
			.delete(schema.playlists)
			.where(and(eq(schema.playlists.userId, userId), eq(schema.playlists.name, name)))
			.returning()
			.execute();
		return rows.length > 0;
	}

	/** Rename a playlist. Returns null when the source is missing or the target name is taken. */
	public static async rename(userId: string, oldName: string, newName: string): Promise<PlaylistData | null> {
		const rows = await db
			.update(schema.playlists)
			.set({ name: newName, updatedAt: new Date() })
			.where(and(eq(schema.playlists.userId, userId), eq(schema.playlists.name, oldName)))
			.returning()
			.execute();
		return rows[0] ?? null;
	}

	/** Append a track to the end of a playlist. */
	public static async addTrack(playlistId: string, track: PlaylistTrackInput): Promise<PlaylistTrackData | null> {
		const { nanoid } = await import("nanoid");
		const position = (await Playlist.countTracks(playlistId)) + 1;
		const rows = await db
			.insert(schema.playlistTracks)
			.values({
				id: nanoid(),
				playlistId,
				title: track.title ?? null,
				uri: track.uri,
				author: track.author ?? null,
				duration: track.duration ?? null,
				position,
				createdAt: new Date(),
			})
			.returning()
			.execute();
		await db.update(schema.playlists).set({ updatedAt: new Date() }).where(eq(schema.playlists.id, playlistId)).execute();
		return rows[0] ?? null;
	}

	/** Remove the track at a 1-based position and close the gap in remaining positions. */
	public static async removeTrack(playlistId: string, position: number): Promise<PlaylistTrackData | null> {
		const rows = await db
			.delete(schema.playlistTracks)
			.where(and(eq(schema.playlistTracks.playlistId, playlistId), eq(schema.playlistTracks.position, position)))
			.returning()
			.execute();
		const removed = rows[0];
		if (!removed) return null;

		await db
			.update(schema.playlistTracks)
			.set({ position: sql`${schema.playlistTracks.position} - 1` })
			.where(and(eq(schema.playlistTracks.playlistId, playlistId), gt(schema.playlistTracks.position, position)))
			.execute();
		await db.update(schema.playlists).set({ updatedAt: new Date() }).where(eq(schema.playlists.id, playlistId)).execute();
		return removed;
	}

	/** Every stored track of a playlist in playback order. */
	public static async getTracks(playlistId: string): Promise<PlaylistTrackData[]> {
		return db.select().from(schema.playlistTracks).where(eq(schema.playlistTracks.playlistId, playlistId)).orderBy(asc(schema.playlistTracks.position)).execute();
	}

	/** Number of tracks stored in a playlist. */
	public static async countTracks(playlistId: string): Promise<number> {
		const rows = await db
			.select({ count: sql<number>`count(*)` })
			.from(schema.playlistTracks)
			.where(eq(schema.playlistTracks.playlistId, playlistId))
			.execute();
		return Number(rows[0]?.count ?? 0);
	}
}
