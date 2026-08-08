ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "prefixes" text[] DEFAULT '{}' NOT NULL;
UPDATE "guilds" SET "prefixes" = ARRAY["prefix"] WHERE cardinality("prefixes") = 0 AND "prefix" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"bio" text,
	"badges" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

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
