import { env } from "@repo/env";
import { runtimeConfig } from "./seyfert.config.js";

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
export type SubscriptionCurrency = "USD";

export type Subscription = Readonly<{
	/** Legacy major-unit amount retained for existing consumers. */
	amount: number;
	/** Canonical integer price in the currency's minor unit. */
	amountMinor: number;
	currency: SubscriptionCurrency;
	server: number;
	name: tier;
	description: string;
}>;

export type SubscriptionType = "basic" | "pro" | "ultimate";

export const subscriptions: readonly Subscription[] = Object.freeze([
	Object.freeze({
		amount: 3,
		amountMinor: 300,
		currency: "USD",
		server: 1,
		name: tier.basic,
		description: "You can use the bot for 1 server.",
	}),
	Object.freeze({
		amount: 6,
		amountMinor: 600,
		currency: "USD",
		server: 3,
		name: tier.pro,
		description: "You can use the bot for 3 servers.",
	}),
	Object.freeze({
		amount: 11,
		amountMinor: 1_100,
		currency: "USD",
		server: 6,
		name: tier.ultimate,
		description: "You can use the bot for 6 servers.",
	}),
]);
