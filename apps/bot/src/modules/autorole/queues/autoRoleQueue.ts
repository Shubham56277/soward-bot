import { Queue } from "bullmq";
import { AutoRoleJobData } from "../types/AutoRoleJobData";
import type BaseClient from "../../../base/Client";

let autoRoleQueue: Queue<AutoRoleJobData> | null = null;

export function createAutoRoleQueue(client: BaseClient): Queue<AutoRoleJobData> {
	if (!autoRoleQueue) {
		autoRoleQueue = new Queue<AutoRoleJobData>("auto-role", {
			connection: client.redis,
			defaultJobOptions: {
				removeOnComplete: true,
				removeOnFail: false,
			},
		});
	}
	return autoRoleQueue;
}

export async function shutdownAutoRoleQueue(): Promise<void> {
	const queue = autoRoleQueue;
	autoRoleQueue = null;
	await queue?.close();
}
