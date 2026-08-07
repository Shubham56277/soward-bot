import { Worker } from "bullmq";
import { GiveawayJobData } from "../types/GiveawayJobData";
import type BaseClient from "../../../base/Client";
import { giveawaysManager } from "../giveawaysManager";
import { Giveaway } from "@repo/db";

let giveawayWorker: Worker<GiveawayJobData> | null = null;

export function startGiveawayWorker(client: BaseClient): Worker<GiveawayJobData> {
	if (giveawayWorker) return giveawayWorker;

	const worker = new Worker<GiveawayJobData>(
		"giveaway",
		async (job) => {
			const { guildId, messageId } = job.data;
			const giveaway = await Giveaway.get(guildId, messageId);
			if (!giveaway || giveaway.ended) return;
			await giveawaysManager.end(client, guildId, messageId);
		},
		{
			connection: client.redis,
			concurrency: 25,
			removeOnComplete: { count: 100 },
			removeOnFail: { count: 100 },
		},
	);
	worker.on("error", (error) => client.logger.error("[giveaway-worker] Worker error", error));
	worker.on("failed", (job, error) => {
		client.logger.error(`[giveaway-worker] Job ${job?.id ?? "unknown"} failed`, error);
	});
	giveawayWorker = worker;
	return worker;
}

export async function shutdownGiveawayWorker(): Promise<void> {
	const worker = giveawayWorker;
	giveawayWorker = null;
	await worker?.close();
}
