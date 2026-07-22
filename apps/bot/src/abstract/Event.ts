import { Awaitable, ClientEvents } from "discord.js";
import { LavalinkManagerEvents, NodeManagerEvents } from "lavalink-client";
import BaseClient from "../base/Client";

export type AllEvents = LavalinkManagerEvents & NodeManagerEvents & ClientEvents;

export interface EventOptions {
	event: keyof AllEvents;
	one?: boolean;
}

export default abstract class Event {
	public one: boolean;
	public event: string;

	constructor(
		protected readonly client: BaseClient,
		options: EventOptions,
	) {
		this.event = options.event;
		this.one = options.one ?? false;
	}

	public async execute(..._args: any): Promise<void> {}
}

export type ClientEventRun<K extends keyof ClientEvents> = (...args: ClientEvents[K]) => Awaitable<any>;

export interface ClientEvent<K extends keyof ClientEvents> {
	/** The event name. */
	name: K;
	/** The event run. */
	run: ClientEventRun<K>;
	/** Emit the event one time. */
	once?: boolean;
	/** The event will be ignored */
	disabled?: boolean;
}
