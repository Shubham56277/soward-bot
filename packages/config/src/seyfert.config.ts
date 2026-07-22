import { config } from "seyfert";
import type { InternalRuntimeConfig } from "seyfert/lib/client/base";
import { env } from "@repo/env";


if (!env.DISCORD_APP_TOKEN) {
	throw new Error("Missing DISCORD_APP_TOKEN");
}

export const runtimeConfig: InternalRuntimeConfig = config.bot({
	locations: {
		base: "dist",
		commands: "commands",
		events: "events",
		lavalink: "lavalink",
		components: "components",
	},
	intents: [
		"AutoModerationConfiguration",
		"AutoModerationExecution",
		"DirectMessagePolls",
		"DirectMessageReactions",
		"DirectMessageTyping",
		"DirectMessages",
		"DirectMessages",
		"GuildExpressions",
		"GuildIntegrations",
		"GuildInvites",
		"GuildMembers",
		"GuildMessagePolls",
		"GuildMessageReactions",
		"GuildMessageTyping",
		"GuildMessages",
		"GuildModeration",
		/* "GuildPresences", */
		"GuildScheduledEvents",
		"GuildVoiceStates",
		"GuildWebhooks",
		"Guilds",
		"MessageContent",
	],
	token: env.DISCORD_APP_TOKEN,
	//debug: env.NODE_ENV === "development",
});

declare module "seyfert" {
	export interface ExtendedRCLocations {
		lavalink: string;
	}
}
