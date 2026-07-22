import { Queue } from "bullmq";
import { GiveawayJobData } from "../types/GiveawayJobData";
import BaseClient from "../../../base/Client";


let giveawayQueue: Queue<GiveawayJobData>;

export function createGiveawayQueue(client: BaseClient) {
	if (!giveawayQueue) {
		giveawayQueue = new Queue<GiveawayJobData>("giveaway", {
			connection: client.redis,
			defaultJobOptions: {
				removeOnComplete: true,
				removeOnFail: true,
			}
		});
	}
	return giveawayQueue;
}
