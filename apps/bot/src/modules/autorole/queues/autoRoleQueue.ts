import { Queue } from "bullmq";
import { AutoRoleJobData } from "../types/AutoRoleJobData";
import BaseClient from "../../../base/Client";

let autoRoleQueue: Queue<AutoRoleJobData>;

export function createAutoRoleQueue(client: BaseClient) {
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
