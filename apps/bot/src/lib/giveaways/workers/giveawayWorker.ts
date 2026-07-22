import { Worker } from "bullmq";
import { GiveawayJobData } from "../types/GiveawayJobData";
import BaseClient from "../../../base/Client";
import { giveawaysManager } from "../giveawaysManager";
import { Giveaway } from "@repo/db";

export function startGiveawayWorker(client: BaseClient) {
	new Worker<GiveawayJobData>(
		"giveaway",
		async (job) => {
			const { guildId, messageId } = job.data;

			try {
				const giveaway = await Giveaway.get(guildId, messageId);
				if (!giveaway) return; // Not found

				if (giveaway.ended) return; // Already ended

				await giveawaysManager.end(client, guildId, messageId);
			} catch (err) {
				client.logger?.error("GiveawayWorker Error:", err);
			}
		},
		{
			connection: client.redis,
			concurrency: 1000,
			removeOnComplete: {
				count: 100,
			},
			removeOnFail: {
				count: 100,
			},
		},
	);
}
