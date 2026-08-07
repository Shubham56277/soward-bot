import { env } from "@repo/env";
import { type BotConfig, config } from "seyfert";

export const runtimeConfig: BotConfig = config.bot({
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
