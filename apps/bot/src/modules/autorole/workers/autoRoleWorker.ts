import { Worker } from "bullmq";
import { AutoRoleJobData } from "../types/AutoRoleJobData";
import { AutoNick, AutoRole } from "@repo/db";

import type { Role } from "discord.js";
import type BaseClient from "../../../base/Client";
import { dangerPermissions, replacePlaceholders } from "../../../utils/helper";


let autoRoleWorker: Worker<AutoRoleJobData> | null = null;

export function startAutoRoleWorker(botClient: BaseClient): Worker<AutoRoleJobData> {
	if (autoRoleWorker) return autoRoleWorker;

	const worker = new Worker<AutoRoleJobData>(
		"auto-role",
		async (job) => {
			const { guildId, userId } = job.data;
			const guild = await botClient.guilds.fetch(guildId).catch(() => null);
			if (!guild) return;

			const member = await guild.members.fetch(userId).catch(() => null);
			if (!member) return;

			const autoRoles = await AutoRole.getForGuild(guildId);
			const roleIds = autoRoles
				.filter((role) => role.isBot === member.user.bot && role.enabled)
				.map((role) => role.roleId);
			const fetchedRoles = await Promise.all(roleIds.map((roleId) => guild.roles.fetch(roleId).catch(() => null)));
			const safeRoles = fetchedRoles.filter((role): role is Role =>
				role !== null && !member.roles.cache.has(role.id) && !role.permissions.has(dangerPermissions),
			);

			if (safeRoles.length > 0) await member.roles.add(safeRoles, "Auto role system");

			const autoNick = await AutoNick.get(guild.id);
			if (!autoNick?.enabled || !member.manageable || member.user.bot) return;

			const nick = replacePlaceholders(autoNick.nickname, member, guild);
			await member.setNickname(nick, "AutoNick system");
		},
		{
			connection: botClient.redis,
			concurrency: 25,
			limiter: {
				max: 5,
				duration: 5000,
			},
		},
	);
	worker.on("error", (error) => botClient.logger.error("[autorole-worker] Worker error", error));
	worker.on("failed", (job, error) => {
		botClient.logger.error(`[autorole-worker] Job ${job?.id ?? "unknown"} failed`, error);
	});
	autoRoleWorker = worker;
	return worker;
}

export async function shutdownAutoRoleWorker(): Promise<void> {
	const worker = autoRoleWorker;
	autoRoleWorker = null;
	await worker?.close();
}
