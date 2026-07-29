CREATE TABLE IF NOT EXISTS "playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlists_user_id_name_unique" UNIQUE("user_id","name")
);

CREATE TABLE IF NOT EXISTS "playlist_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"playlist_id" text NOT NULL REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
	"title" text,
	"uri" text NOT NULL,
	"author" text,
	"duration" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "playlists_user_id_idx" ON "playlists" ("user_id");
CREATE INDEX IF NOT EXISTS "playlist_tracks_playlist_id_idx" ON "playlist_tracks" ("playlist_id");
