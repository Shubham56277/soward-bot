import { Worker } from "bullmq";
import { AutoRoleJobData } from "../types/AutoRoleJobData";
import { AutoNick, AutoRole } from "@repo/db";

import BaseClient from "../../../base/Client";
import { dangerPermissions, replacePlaceholders } from "../../../utils/helper";


export function startAutoRoleWorker(botClient: BaseClient) {
	new Worker<AutoRoleJobData>(
		"auto-role",
		async (job) => {
			const { guildId, userId } = job.data;

			const guild = await botClient.guilds.fetch(guildId).catch(() => null);
			if (!guild) return;

			const member = await guild.members.fetch(userId).catch(() => null);
			if (!member) return;

			const isBot = member.user.bot;
			const autoRoles = await AutoRole.getForGuild(guildId);
			const applicableRoles = autoRoles.filter((r) => r.isBot === isBot && r.enabled);

			const rolesToAdd = applicableRoles.map((r) => r.roleId);

			const validRoles = (
				await Promise.all(
					rolesToAdd.map(async (roleId) => {
						try {
							const role = await guild.roles.fetch(roleId);
							return role && !member.roles.cache.has(roleId) ? role : null;
						} catch {
							return null;
						}
					}),
				)
			).filter((role) => role !== null);

			const dangerousRoles = await Promise.all(
				validRoles.map(async (role) => {
					return role.permissions.has(dangerPermissions);
				}),
			);

			validRoles.filter((role, index) => !dangerousRoles[index]);

			if (validRoles.length > 0) {
				await member.roles.add(validRoles, "Auto role system");
			}
			// Get auto nick configuration
			const autoNick = await AutoNick.get(guild.id);

			if (!autoNick || !autoNick.enabled) return;

			if (member.manageable && !member.user.bot) { // If member is not a bot

				const nick = replacePlaceholders(autoNick.nickname, member, guild);
				await member.setNickname(`${nick}`, "AutoNick system");
			}
			// Optional delay between users
			await new Promise((res) => setTimeout(res, 1000));
		},
		{
			connection: botClient.redis,
			concurrency: 1000,
			limiter: {
				max: 5,
				duration: 5000, // Max 5 jobs every 5 seconds
			},
		},
	);
}
