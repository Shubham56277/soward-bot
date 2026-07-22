import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { ActivityType } from "discord.js";
import { on } from "node:events";
import { env } from "@repo/env";
import { startGiveawayWorker } from "../../lib/giveaways/workers/giveawayWorker";
import { giveawaysManager } from "../../lib/giveaways/giveawaysManager";
import { startAutoRoleWorker } from "../../modules/autorole/workers/autoRoleWorker";

export default class Ready extends Event {
	constructor(client: BaseClient) {
		super(client, {
			event: "clientReady",
		});
	}

	public async execute(): Promise<void> {
		for await (const _ of on(this.client, this.event)) {
			this.client.logger.success(`${this.client.user?.tag} is ready!`);

			this.client.user?.setPresence({
				activities: [
					{
						name: "Soward",
						type: ActivityType.Listening,
					},
				],
				status: "online",
			});

			// Do not block Discord readiness on Lavalink startup.
			void this.client.manager.init({ ...this.client.user!, shards: "auto" }).catch((error) => {
				this.client.logger.error("Lavalink initialization failed:", error);
			});

			this.client.cluster.triggerReady();

			void (async () => {
				try {
					if (env.NODE_ENV === "development") {
						await this.client.deployCommands(env.GUILD_ID);
					} else {
						await this.client.deployCommands();
					}
					startAutoRoleWorker(this.client);
					startGiveawayWorker(this.client);
					await giveawaysManager.scheduled(this.client);
				} catch (error) {
					this.client.logger.error("Post-ready initialization failed:", error);
				}
			})();
		}
	}
}
