CREATE TABLE IF NOT EXISTS "badge_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"image_url" text,
	"asset_path" text,
	"description" text NOT NULL,
	"sort_priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_definitions_key_check"
		CHECK ("key" ~ '^[a-z0-9]+([a-z0-9_-]*[a-z0-9])?$'),
	CONSTRAINT "badge_definitions_asset_check"
		CHECK (
			("image_url" IS NOT NULL AND "asset_path" IS NULL AND "image_url" ~ '^https://')
			OR
			("image_url" IS NULL AND "asset_path" IS NOT NULL
				AND "asset_path" ~ '^[A-Za-z0-9_./-]+$'
				AND "asset_path" !~ '(^|/)\.\.(/|$)'
				AND "asset_path" !~ '^/')
		),
	CONSTRAINT "badge_definitions_priority_check" CHECK ("sort_priority" >= 0),
	CONSTRAINT "badge_definitions_type_check" CHECK ("type" IN ('animated', 'static')),
	CONSTRAINT "badge_definitions_version_check" CHECK ("version" > 0)
);

CREATE TABLE IF NOT EXISTS "user_badges" (
	"user_id" text NOT NULL,
	"badge_key" text NOT NULL,
	"grant_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_by" text,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_key_pk" PRIMARY KEY("user_id", "badge_key"),
	CONSTRAINT "user_badges_version_check" CHECK ("version" > 0),
	CONSTRAINT "user_badges_badge_key_badge_definitions_key_fk"
		FOREIGN KEY ("badge_key") REFERENCES "badge_definitions"("key") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add the users relationship only when the legacy prerequisite is present. NOT VALID
-- preserves any pre-existing assignments; it is validated immediately when no orphans exist.
DO $$
BEGIN
	IF to_regclass('public.users') IS NOT NULL
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

CREATE INDEX IF NOT EXISTS "badge_definitions_active_priority_idx"
	ON "badge_definitions" ("enabled", "sort_priority");
CREATE INDEX IF NOT EXISTS "user_badges_user_expiry_idx"
	ON "user_badges" ("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "user_badges_badge_key_idx"
	ON "user_badges" ("badge_key");

-- Keep user_profiles.badges untouched. Backfill exact keys only when both legacy
-- columns exist, supporting historical text[], JSON arrays, and scalar text.
DO $$
BEGIN
	IF to_regclass('public.user_profiles') IS NULL
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
