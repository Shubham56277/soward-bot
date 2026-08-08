import { Client, type ClientOptions } from "discord.js";
import { container } from "tsyringe";
import { closeRedis } from "./redis.js";

export class FrameWorkClient extends Client {
	constructor(options: ClientOptions) {
		super(options);
		container.register(Client, { useValue: this });
	}

	public override async destroy(): Promise<void> {
		try {
			await super.destroy();
		} finally {
			await closeRedis();
		}
	}
}
