import { AntiNukeMember } from "@repo/db";
import { AuditLogEvent, Events, Guild } from "discord.js";
import Event from "../../abstract/Event";
import BaseClient from "../../base/Client";
import { isMatchingFreshAntiNukeAuditEntry } from "../../modules/antiNukeState";

const AUDIT_LOOKBACK_LIMIT = 6;

export default class GuildMemberRemove extends Event {
	constructor(client: BaseClient) {
		super(client, { event: Events.GuildMemberRemove });
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildMemberRemove, async (member) => {
			const guild = member.guild;
			if (!guild) return;

			try {
				const config = await this.client.services.antinukes.getConfig(guild.id);
				if (!config.enabled) return;

				const normalKick = config.member.find(entry => entry.type === "kick" && entry.enabled);
				const infiniteVoid = config.member.find(entry => entry.type === "infiniteVoid" && entry.enabled);
				if (!normalKick && !infiniteVoid) return;

				const logs = await guild.fetchAuditLogs({
					limit: AUDIT_LOOKBACK_LIMIT,
					type: AuditLogEvent.MemberKick,
				}).catch((error) => {
					this.client.logger.error("[AntiNuke] MemberKick audit fetch failed:", error);
					return null;
				});
				if (!logs) return;

				const auditEntry = logs.entries.find(entry => entry.target?.id === member.id);
				if (!auditEntry?.executor?.id || !auditEntry.target?.id) return;

				const executorId = auditEntry.executor.id;
				if (infiniteVoid) {
					const emergency = await this.client.services.antinukes.recordInfiniteVoidKick(
						guild,
						executorId,
						member.id,
						auditEntry.id,
						auditEntry.createdTimestamp,
					);
					if (emergency.thresholdReached) return;
				}

				if (normalKick) await this.handleNormalMemberKick(guild, executorId, normalKick);
			} catch (error) {
				this.client.logger.error("[AntiNuke] MemberKick handling failed:", error);
			}
		});
	}

	private async handleNormalMemberKick(
		guild: Guild,
		executorId: string,
		actionConfig: AntiNukeMember,
	): Promise<void> {
		if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

		let member = guild.members.cache.get(executorId);
		if (!member) {
			member = await guild.members.fetch(executorId).catch((error) => {
				this.client.logger.error("[AntiNuke] Kick executor fetch failed:", error);
				return null;
			}) ?? undefined;
		}
		if (!member || !guild.members.me || !this.client.services.antinukes.canModerate(member, guild.members.me)) return;

		if (actionConfig.limit > 1) {
			const thresholdReached = await this.client.services.antinukes.trackAction(
				guild,
				executorId,
				"memberKick",
				actionConfig,
			);
			if (!thresholdReached) return;
		}

		await this.client.services.antinukes.punishUser(
			guild,
			executorId,
			actionConfig.action,
			"Anti-Member Protection | Unauthorized Kick",
		);
	}
}
