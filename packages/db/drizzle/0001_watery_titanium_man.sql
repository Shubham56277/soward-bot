CREATE TABLE "premium_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"duration_ms" bigint NOT NULL,
	"created_by" text NOT NULL,
	"redeemed_by" text,
	"redeemed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
