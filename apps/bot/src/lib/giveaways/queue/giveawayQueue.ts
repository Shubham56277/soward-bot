import { Queue } from "bullmq";
import { GiveawayJobData } from "../types/GiveawayJobData";
import type BaseClient from "../../../base/Client";


let giveawayQueue: Queue<GiveawayJobData> | null = null;

export function createGiveawayQueue(client: BaseClient): Queue<GiveawayJobData> {
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

export async function shutdownGiveawayQueue(): Promise<void> {
	const queue = giveawayQueue;
	giveawayQueue = null;
	await queue?.close();
}
