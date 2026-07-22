-- Migration: Add moderation cases and new security tables
-- Creates tables for moderation history, premium features, and security systems

-- Moderation cases for tracking all moderation actions
CREATE TABLE IF NOT EXISTS "moderation_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"target_id" text NOT NULL,
	"moderator_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"duration" bigint,
	"extra" jsonb,
	"resolved" boolean DEFAULT false,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for moderation cases
CREATE INDEX IF NOT EXISTS "moderation_cases_guild_id_idx" ON "moderation_cases"("guild_id");
CREATE INDEX IF NOT EXISTS "moderation_cases_target_id_idx" ON "moderation_cases"("target_id");
CREATE INDEX IF NOT EXISTS "moderation_cases_moderator_id_idx" ON "moderation_cases"("moderator_id");
CREATE INDEX IF NOT EXISTS "moderation_cases_created_at_idx" ON "moderation_cases"("created_at" DESC);

-- Guild premium subscriptions
CREATE TABLE IF NOT EXISTS "guild_premium" (
	"guild_id" text PRIMARY KEY NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"is_premium" boolean DEFAULT false,
	"premium_since" timestamp with time zone,
	"premium_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Co-owners for guild management
CREATE TABLE IF NOT EXISTS "coowners" (
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("guild_id", "user_id")
);

-- Trusted members with scoped permissions
CREATE TABLE IF NOT EXISTS "trusted_members" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"scope" text DEFAULT 'global',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "trusted_members_guild_id_idx" ON "trusted_members"("guild_id");

-- Ignore rules for features
CREATE TABLE IF NOT EXISTS "ignore_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"type" text NOT NULL,
	"target_id" text NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ignore_rules_guild_id_idx" ON "ignore_rules"("guild_id");

-- Main roles for hierarchy
CREATE TABLE IF NOT EXISTS "main_roles" (
	"guild_id" text PRIMARY KEY NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Security snapshots for recovery
CREATE TABLE IF NOT EXISTS "security_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "security_snapshots_guild_id_idx" ON "security_snapshots"("guild_id");

-- Panic mode configuration
CREATE TABLE IF NOT EXISTS "panic_mode_configs" (
	"guild_id" text PRIMARY KEY NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"enabled" boolean DEFAULT false,
	"lockdown_roles" text[] DEFAULT '{}',
	"notify_channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- AutoMod rules
CREATE TABLE IF NOT EXISTS "automod_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"action" text NOT NULL,
	"punishment" text,
	"duration" bigint,
	"threshold" integer,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "automod_rules_guild_id_idx" ON "automod_rules"("guild_id");

-- AutoMod exemptions
CREATE TABLE IF NOT EXISTS "automod_exemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"rule_id" text NOT NULL,
	"type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "automod_exemptions_guild_id_idx" ON "automod_exemptions"("guild_id");

-- Auto reactions
CREATE TABLE IF NOT EXISTS "auto_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"channel_id" text,
	"trigger" text NOT NULL,
	"reactions" text[] NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auto_reactions_guild_id_idx" ON "auto_reactions"("guild_id");

-- Notifiers for events
CREATE TABLE IF NOT EXISTS "notifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"channel_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifiers_guild_id_idx" ON "notifiers"("guild_id");

-- Auto delete rules
CREATE TABLE IF NOT EXISTS "auto_delete_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"channel_id" text NOT NULL,
	"delay" integer NOT NULL DEFAULT 10,
	"filter" jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auto_delete_rules_guild_id_idx" ON "auto_delete_rules"("guild_id");

-- Sticky messages
CREATE TABLE IF NOT EXISTS "sticky_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"content" text NOT NULL,
	"embed" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sticky_messages_guild_id_idx" ON "sticky_messages"("guild_id");

-- Reaction roles
CREATE TABLE IF NOT EXISTS "reaction_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"emoji" text NOT NULL,
	"role_id" text NOT NULL,
	"mode" text DEFAULT 'normal',
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "reaction_roles_guild_id_idx" ON "reaction_roles"("guild_id");
CREATE INDEX IF NOT EXISTS "reaction_roles_message_id_idx" ON "reaction_roles"("message_id");

-- Reaction role options for multi-role setups
CREATE TABLE IF NOT EXISTS "reaction_role_options" (
	"id" text PRIMARY KEY NOT NULL,
	"reaction_role_id" text NOT NULL REFERENCES "reaction_roles"("id") ON DELETE CASCADE,
	"emoji" text NOT NULL,
	"role_id" text NOT NULL,
	"label" text,
	"description" text
);

-- Saved embeds
CREATE TABLE IF NOT EXISTS "saved_embeds" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"name" text NOT NULL,
	"embed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_embeds_guild_id_idx" ON "saved_embeds"("guild_id");
CREATE UNIQUE INDEX IF NOT EXISTS "saved_embeds_guild_id_name_idx" ON "saved_embeds"("guild_id", "name");

-- Ticket panels
CREATE TABLE IF NOT EXISTS "ticket_panels" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"name" text NOT NULL,
	"description" text,
	"channel_id" text NOT NULL,
	"category_id" text NOT NULL,
	"message_id" text,
	"support_roles" text[] NOT NULL DEFAULT '{}',
	"max_tickets" integer DEFAULT 1,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ticket_panels_guild_id_idx" ON "ticket_panels"("guild_id");

-- Welcome configs for different event types
CREATE TABLE IF NOT EXISTS "welcome_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
	"type" text NOT NULL,
	"channel_id" text NOT NULL,
	"message" text,
	"embed" jsonb,
	"enabled" boolean DEFAULT true,
	"premium" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "welcome_configs_guild_id_idx" ON "welcome_configs"("guild_id");
CREATE INDEX IF NOT EXISTS "welcome_configs_guild_id_type_idx" ON "welcome_configs"("guild_id", "type");

-- Add primary keys to existing tables that lack them
ALTER TABLE "afk" ADD CONSTRAINT "afk_pkey" PRIMARY KEY ("user_id", "guild_id");
ALTER TABLE "voiceCreators" ADD CONSTRAINT "voice_creators_pkey" PRIMARY KEY ("voice_channel_id");
ALTER TABLE "voice_settings" ADD CONSTRAINT "voice_settings_pkey" PRIMARY KEY ("guild_id", "user_id");
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("guild_id");

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "warnings_guild_id_idx" ON "warnings"("guild_id");
CREATE INDEX IF NOT EXISTS "warnings_user_id_idx" ON "warnings"("user_id");
CREATE INDEX IF NOT EXISTS "warnings_created_at_idx" ON "warnings"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "tickets_guild_id_idx" ON "tickets"("guild_id");
CREATE INDEX IF NOT EXISTS "tickets_user_id_idx" ON "tickets"("user_id");
CREATE INDEX IF NOT EXISTS "tickets_status_idx" ON "tickets"("status");

CREATE INDEX IF NOT EXISTS "giveaways_guild_id_idx" ON "giveaways"("guildId");
CREATE INDEX IF NOT EXISTS "giveaways_ended_idx" ON "giveaways"("ended");

CREATE INDEX IF NOT EXISTS "auto_responder_guild_id_idx" ON "auto_responder"("guild_id");

CREATE INDEX IF NOT EXISTS "auto_role_guild_id_idx" ON "auto_role"("guild_id");

CREATE INDEX IF NOT EXISTS "logger_guild_id_idx" ON "logger"("guild_id");
