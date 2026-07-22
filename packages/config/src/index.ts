import { runtimeConfig } from "./seyfert.config";
import { env } from "@repo/env";

const config = {
	rc: runtimeConfig,
	prefix: env.PREFIX,
	colors: {
		main: 0x667fff,
		gray: 0x2d2d2d,
		orange: 0xef9651,
		red: 0xec5228,
	},
	emojis: {
		on: "<:not_disabled:1364258995665109145><:enabled:1364259176498597968>",
		off: "<:nodc:1364259095825350677><:not_enabled:1364259214092013579>",
	},
	links: {
		invite: "https://discord.gg/discord",
		supportServer: "https://discord.gg/discord",
	},
	images: {
		blank: "https://i.imgur.com/r9liXrq.png",
	},

} as const;

export { config };

export enum tier {
	basic = "basic",
	pro = "pro",
	ultimate = "ultimate",
}
export type Subscription = {
	amount: number;
	server: number;
	name: tier;
	description: string;
};

export type SubscriptionType = "basic" | "pro" | "ultimate";

export const subscriptions: Subscription[] = [
	{
		amount: 3,
		server: 1,
		name: tier.basic,
		description: "You can use the bot for 1 server.",
	},
	{
		amount: 6,
		server: 3,
		name: tier.pro,
		description: "You can use the bot for 3 servers.",
	},
	{
		amount: 11,
		server: 6,
		name: tier.ultimate,
		description: "You can use the bot for 6 servers.",
	},
];
