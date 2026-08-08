-- Repair databases where 0006 was already recorded while prerequisites differed.
-- Reconcile the idempotent parts of 0003-0005 first because Drizzle only runs
-- migrations newer than the latest recorded journal timestamp.
DO $$
BEGIN
	IF to_regclass('public.guilds') IS NOT NULL THEN
		ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "prefixes" text[] DEFAULT '{}' NOT NULL;
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'guilds' AND column_name = 'prefix'
		) THEN
			UPDATE "guilds"
			SET "prefixes" = ARRAY["prefix"]
			WHERE cardinality("prefixes") = 0 AND "prefix" IS NOT NULL;
		END IF;
	END IF;

	IF to_regclass('public.users') IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
		)
	THEN
		CREATE TABLE IF NOT EXISTS "user_profiles" (
			"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
			"bio" text,
			"badges" text[] DEFAULT '{}' NOT NULL,
			"created_at" timestamp with time zone DEFAULT now() NOT NULL,
			"updated_at" timestamp with time zone DEFAULT now() NOT NULL
		);
		ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "no_prefix_allowed" boolean DEFAULT false;
	END IF;

	IF to_regclass('public.guilds') IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'guilds' AND column_name = 'guild_id'
		)
	THEN
		CREATE TABLE IF NOT EXISTS "guild_bot_settings" (
			"guild_id" text PRIMARY KEY NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
			"avatar_url" text,
			"bio" text,
			"banner_url" text,
			"baseline_avatar_url" text,
			"baseline_bio" text,
			"baseline_banner_url" text,
			"baseline_captured_at" timestamp with time zone,
			"created_at" timestamp with time zone DEFAULT now() NOT NULL,
			"updated_at" timestamp with time zone DEFAULT now() NOT NULL
		);
		ALTER TABLE "guild_bot_settings" ADD COLUMN IF NOT EXISTS "baseline_avatar_url" text;
		ALTER TABLE "guild_bot_settings" ADD COLUMN IF NOT EXISTS "baseline_bio" text;
		ALTER TABLE "guild_bot_settings" ADD COLUMN IF NOT EXISTS "baseline_banner_url" text;
		ALTER TABLE "guild_bot_settings" ADD COLUMN IF NOT EXISTS "baseline_captured_at" timestamp with time zone;
	END IF;
END $$;

DO $$
BEGIN
	IF to_regclass('public.users') IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
		)
	THEN
		CREATE TABLE IF NOT EXISTS "playlists" (
			"id" text PRIMARY KEY NOT NULL,
			"user_id" text NOT NULL REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
			"name" text NOT NULL,
			"created_at" timestamp with time zone DEFAULT now() NOT NULL,
			"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
			CONSTRAINT "playlists_user_id_name_unique" UNIQUE("user_id", "name")
		);
	END IF;

	IF to_regclass('public.playlists') IS NOT NULL THEN
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
	END IF;
END $$;

-- Repair badge relationships and replay the safe, definition-gated legacy
-- backfill. Legacy badge arrays remain intact for definitions created later.
DO $$
BEGIN
	IF to_regclass('public.user_badges') IS NOT NULL
		AND to_regclass('public.users') IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
		)
	THEN
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conrelid = 'public.user_badges'::regclass
				AND conname = 'user_badges_user_id_users_user_id_fk'
		) THEN
			ALTER TABLE "user_badges"
				ADD CONSTRAINT "user_badges_user_id_users_user_id_fk"
				FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
				ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
		END IF;

		IF EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conrelid = 'public.user_badges'::regclass
				AND conname = 'user_badges_user_id_users_user_id_fk'
				AND NOT convalidated
		) AND NOT EXISTS (
			SELECT 1 FROM "user_badges" AS assignment
			LEFT JOIN "users" AS app_user ON app_user."user_id" = assignment."user_id"
			WHERE app_user."user_id" IS NULL
		) THEN
			ALTER TABLE "user_badges" VALIDATE CONSTRAINT "user_badges_user_id_users_user_id_fk";
		END IF;
	END IF;
END $$;

-- Existing assignments whose definitions have not been configured remain intact.
-- The NOT VALID foreign key protects all new writes and can be validated once no
-- legacy orphan keys remain; no placeholder definitions or assets are invented.
DO $$
BEGIN
	IF to_regclass('public.user_badges') IS NOT NULL
		AND to_regclass('public.badge_definitions') IS NOT NULL
	THEN
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conrelid = 'public.user_badges'::regclass
				AND conname = 'user_badges_badge_key_badge_definitions_key_fk'
		) THEN
			ALTER TABLE "user_badges"
				ADD CONSTRAINT "user_badges_badge_key_badge_definitions_key_fk"
				FOREIGN KEY ("badge_key") REFERENCES "badge_definitions"("key")
				ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
		END IF;

		IF EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conrelid = 'public.user_badges'::regclass
				AND conname = 'user_badges_badge_key_badge_definitions_key_fk'
				AND NOT convalidated
		) AND NOT EXISTS (
			SELECT 1 FROM "user_badges" AS assignment
			LEFT JOIN "badge_definitions" AS definition ON definition."key" = assignment."badge_key"
			WHERE definition."key" IS NULL
		) THEN
			ALTER TABLE "user_badges" VALIDATE CONSTRAINT "user_badges_badge_key_badge_definitions_key_fk";
		END IF;
	END IF;
END $$;

DO $$
BEGIN
	IF to_regclass('public.user_badges') IS NULL
		OR to_regclass('public.badge_definitions') IS NULL
		OR to_regclass('public.user_profiles') IS NULL
		OR NOT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'user_id'
		)
		OR NOT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'badges'
		)
	THEN
		RETURN;
	END IF;

	EXECUTE $migration$
		INSERT INTO "user_badges" ("user_id", "badge_key", "grant_metadata")
		SELECT profile."user_id", legacy."badge_key", '{"source":"legacy_user_profiles"}'::jsonb
		FROM "user_profiles" AS profile
		CROSS JOIN LATERAL jsonb_array_elements_text(
			CASE jsonb_typeof(to_jsonb(profile."badges"))
				WHEN 'array' THEN to_jsonb(profile."badges")
				WHEN 'string' THEN jsonb_build_array(to_jsonb(profile."badges"))
				ELSE '[]'::jsonb
			END
		) AS legacy("badge_key")
		INNER JOIN "badge_definitions" AS definition ON definition."key" = legacy."badge_key"
		ON CONFLICT ("user_id", "badge_key") DO NOTHING
	$migration$;
END $$;