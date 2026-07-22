import { env } from "@repo/env";
import { ClusterManager, HeartbeatManager, ReClusterManager } from "discord-hybrid-sharding";
import Logger from "./lib/Logger";

export async function shardStart(logger: Logger) {

	const manager = new ClusterManager(`${__dirname}/bot.js`, {
		totalShards: "auto",
		shardsPerClusters: 2,
		mode: "process",
		token: env.DISCORD_APP_TOKEN,

	});


	manager.on("clusterCreate", (cluster) => {
		logger.start(`🟢 Launched Cluster ${cluster.id} with shards: [${cluster.shardList.join(", ")}]`);
	});

	manager.on("shardCreate", (shard) => {
		logger.info(`🟢 Shard ${shard.id} has been created.`);
	});

	manager.on("spawn", (cluster) => {
		logger.info(`🔄 Spawning Cluster ${cluster.id} with shards: ${cluster.shardList.join(", ")}`);
	});

	//manager.on("debug", console.log);

	manager.extend(
		new HeartbeatManager({
			interval: 2000, // Interval to send a heartbeat
			maxMissedHeartbeats: 5, // Maximum amount of missed Heartbeats until Cluster will get respawned
		}),
	);
	// Enable for zero downtime reclustering : https://github.com/meister03/discord-hybrid-sharding#zero-downtime-reclustering
	manager.extend(
		new ReClusterManager({
			restartMode: "gracefulSwitch",
		}),
	);
	manager.spawn({ timeout: -1 });
}
