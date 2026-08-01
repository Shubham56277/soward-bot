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
	CONSTRAINT "user_badges_user_id_users_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "user_badges_badge_key_badge_definitions_key_fk"
		FOREIGN KEY ("badge_key") REFERENCES "badge_definitions"("key") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "badge_definitions_active_priority_idx"
	ON "badge_definitions" ("enabled", "sort_priority");
CREATE INDEX IF NOT EXISTS "user_badges_user_expiry_idx"
	ON "user_badges" ("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "user_badges_badge_key_idx"
	ON "user_badges" ("badge_key");

-- Preserve user_profiles.badges and map only exact legacy keys with an existing definition.
-- ON CONFLICT makes this safe if assignments have already been created independently.
INSERT INTO "user_badges" ("user_id", "badge_key", "grant_metadata")
SELECT profile."user_id", legacy."badge_key", '{"source":"legacy_user_profiles"}'::jsonb
FROM "user_profiles" AS profile
CROSS JOIN LATERAL unnest(profile."badges") AS legacy("badge_key")
INNER JOIN "badge_definitions" AS definition ON definition."key" = legacy."badge_key"
ON CONFLICT ("user_id", "badge_key") DO NOTHING;
