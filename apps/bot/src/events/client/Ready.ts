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
			this.client.logger.success(`[ready] ${this.client.user?.tag} is ready!`);

			this.client.logger.start("[ready] setting presence");
			this.client.user?.setPresence({
				activities: [
					{
						name: "Soward",
						type: ActivityType.Listening,
					},
				],
				status: "online",
			});
			this.client.logger.success("[ready] presence set");

			// Do not block Discord readiness on Lavalink startup.
			this.client.logger.start("[ready] launching Lavalink init");
			void this.client.manager.init({ ...this.client.user!, shards: "auto" }).catch((error) => {
				this.client.logger.error("[ready] Lavalink initialization failed:");
				this.client.logger.error(error);
			});

			this.client.logger.start("[ready] triggering cluster ready");
			this.client.cluster.triggerReady();
			this.client.logger.success("[ready] cluster ready triggered");

			void (async () => {
				try {
					this.client.logger.start("[ready] post-ready init begin");
					if (env.NODE_ENV === "development") {
						this.client.logger.debug("[ready] deploying guild commands");
						await this.client.deployCommands(env.GUILD_ID);
					} else {
						this.client.logger.debug("[ready] deploying global commands");
						await this.client.deployCommands();
					}
					this.client.logger.start("[ready] starting auto role worker");
					startAutoRoleWorker(this.client);
					this.client.logger.success("[ready] auto role worker started");
					this.client.logger.start("[ready] starting giveaway worker");
					startGiveawayWorker(this.client);
					this.client.logger.success("[ready] giveaway worker started");
					this.client.logger.start("[ready] scheduling giveaways");
					await giveawaysManager.scheduled(this.client);
					this.client.logger.success("[ready] giveaways scheduled");
					this.client.logger.success("[ready] post-ready init complete");
				} catch (error) {
					this.client.logger.error("[ready] post-ready initialization failed:");
					this.client.logger.error(error);
				}
			})();
		}
	}
}
