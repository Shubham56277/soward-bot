declare module "@repo/framework" {
	import { Client, type ClientOptions, REST, type RESTOptions } from "discord.js";
	import type Redis from "ioredis";

	export class FrameWorkClient extends Client {
		constructor(options: ClientOptions);
		override destroy(): Promise<void>;
	}

	export function createRedis(): Promise<Redis>;
	export function createREST(options?: Partial<RESTOptions>): REST;
}
