CREATE TABLE "afk" (
	"user_id" text NOT NULL,
	"reason" text DEFAULT 'AFK',
	"global" boolean DEFAULT false,
	"guild_id" text,
	"mentionBy" json DEFAULT '[]'::json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anti_nuke" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false,
	"admin" text,
	"trustedUsers" json,
	"channel" json,
	"member" json,
	"emoji" json,
	"role" json,
	"webhook" json,
	"sticker" json,
	"guild" json,
	"mention" boolean DEFAULT false,
	"gatekeeper" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automod" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false,
	"spam" json DEFAULT '{"enabled":false,"action":"timeout","ignoredChannels":[],"ignoredRoles":[],"ignoredUsers":[],"spamLimit":7,"maxEmojis":10}'::json,
	"link" json DEFAULT '{"enabled":false,"allowedDomains":[],"ignoredChannels":[],"ignoredRoles":[],"ignoredUsers":[],"action":"delete"}'::json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_nick" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_responder" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"response" text NOT NULL,
	"use_regex" boolean DEFAULT false,
	"reaction_emoji" text,
	"cooldown" integer DEFAULT 10,
	"created_at" timestamp DEFAULT now(),
	"channel_id" text,
	"enabled" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "auto_role" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blacklist" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_roles" (
	"guild_id" text NOT NULL,
	"manager_role" text,
	"roles" json
);
--> statement-breakpoint
CREATE TABLE "giveaways" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"channelId" text NOT NULL,
	"hostedBy" text NOT NULL,
	"messageId" text NOT NULL,
	"prize" text NOT NULL,
	"winners" integer NOT NULL,
	"duration" bigint NOT NULL,
	"ended" boolean DEFAULT false NOT NULL,
	"endAt" timestamp with time zone NOT NULL,
	"participants" json,
	"paused" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_ticket_counters" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"last_ticket_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"247" json,
	"guild_id" text PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT '?',
	"language" text DEFAULT 'en',
	"custom_roles" json,
	"ignore_commands" json,
	"giveaways_manager_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ignored_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"unignore_role" text[] DEFAULT '{}' NOT NULL,
	"unignore_user" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logger" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false,
	"channel_and_type" json
);
--> statement-breakpoint
CREATE TABLE "media_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_premium" boolean DEFAULT false,
	"premium_since" timestamp with time zone,
	"premium_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_buttons" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"labels" text[] NOT NULL,
	"emojis" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"voiceChannelId" text NOT NULL,
	"ownerId" text NOT NULL,
	"cooldown" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"open_limit" integer DEFAULT 1 NOT NULL,
	"channel_id" text,
	"logger_channel_id" text,
	"category_id" text,
	"message_id" text,
	"open_category_id" text,
	"support_roles" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_number" integer NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"topic" text,
	"transcript" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"claimed_by" text,
	"connection_id" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"no_prefix" boolean DEFAULT false,
	"no_prefix_expires_at" timestamp with time zone,
	"level" integer DEFAULT 0,
	"xp" integer DEFAULT 0,
	"relationships" text DEFAULT 'single',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_channel_role" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voiceCreators" (
	"guild_id" text NOT NULL,
	"textChannelId" text NOT NULL,
	"voiceChannelId" text NOT NULL,
	"categoryId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_settings" (
	"guild_id" text NOT NULL,
	"userId" text NOT NULL,
	"name" text DEFAULT '0' NOT NULL,
	"userLimit" integer DEFAULT 10 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"leave" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warnings" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"moderator_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message" text NOT NULL,
	"type" text NOT NULL,
	"embed" json,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "afk" ADD CONSTRAINT "afk_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "afk" ADD CONSTRAINT "afk_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anti_nuke" ADD CONSTRAINT "anti_nuke_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automod" ADD CONSTRAINT "automod_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "auto_nick" ADD CONSTRAINT "auto_nick_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ignored_channels" ADD CONSTRAINT "ignored_channels_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "media_channel" ADD CONSTRAINT "media_channel_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "premium" ADD CONSTRAINT "premium_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_configs" ADD CONSTRAINT "ticket_configs_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_connection_id_ticket_configs_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ticket_configs"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "voiceCreators" ADD CONSTRAINT "voiceCreators_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "voice_settings" ADD CONSTRAINT "voice_settings_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE cascade;