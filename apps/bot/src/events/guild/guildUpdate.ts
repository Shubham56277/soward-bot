import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class GuildUpdate extends Event {
	private guildSettingsCache = new Map<string, { settings: any; expires: number }>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.GuildUpdate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
			if (!newGuild) return;
			const guildId = newGuild.id;


			try {
				const config = await this.client.services.antinukes.getConfig(guildId);

				// Fast path: return early if no action needed
				const actionConfig = config?.guild?.find(c => c.type === "update");
				if (!actionConfig?.enabled || !config?.enabled) return;

				const logs = await newGuild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.GuildUpdate
				}).catch(error => {
					this.client.logger?.error?.(error);
					return null;
				});
				if (!logs) return;

				const log = logs.entries.first();
				if (!log?.executor) return;

				const executorId = log.executor.id;
				const now = Date.now();

				// Ultra-fast permission checks
				if (this.shouldSkipAction(newGuild, executorId, config, now, log.createdTimestamp)) {
					return;
				}

				if (await this.client.services.antinukes.isBypassed(newGuild, executorId)) {
					return;
				}

				// Check moderation permissions (cached member lookup)
				if (!await this.canModerate(newGuild, executorId)) {
					return;
				}
				if (actionConfig.limit <= 1) {
					const enforced = await this.client.services.antinukes.punishUser(
						newGuild,
						executorId,
						actionConfig.action,
						"Anti-Guild Protection | Not Whitelisted",
					);
					if (enforced) {
						this.updateGuild(oldGuild, newGuild).catch(error => {
							this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
						});
					}
					return;
				}
				const tracked = await this.client.services.antinukes.trackAction(
					newGuild,
					executorId,
					"guildUpdate",
					actionConfig
				);

				if (tracked) {
					const enforced = await this.client.services.antinukes.punishUser(
						newGuild,
						executorId,
						actionConfig.action,
						"Anti-Guild Protection | Not Whitelisted",
					);
					if (enforced) {
						this.updateGuild(oldGuild, newGuild).catch(error => {
							this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
						});
					}
				}

			} catch (error) {
				this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
				this.guildSettingsCache.delete(guildId);
			}
		});
	}

	private shouldSkipAction(
		guild: any,
		executorId: string,
		config: AntiNuke,
		now: number,
		createdTimestamp: number
	): boolean {
		return (
			executorId === guild.ownerId ||
			executorId === this.client.user?.id ||
			executorId === config.admin ||
			(now - createdTimestamp) > 120000
		);
	}

	private async canModerate(guild: any, executorId: string): Promise<boolean> {
		// Check cache first
		let member = guild.members.cache.get(executorId);
		if (!member) {
			member = await guild.members.fetch(executorId).catch((error: unknown) => {
				this.client.logger?.error?.(error);
				return null;
			});
			if (!member) return false;
		}
		return this.client.services.antinukes.canModerate(member, guild.members.me!);
	}
	private async updateGuild(oldGuild: any, newGuild: any): Promise<void> {
		if (oldGuild.name !== newGuild.name) {
			await newGuild.setName(oldGuild.name, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.icon !== newGuild.icon) {
			await newGuild.setIcon(oldGuild.icon, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.splash !== newGuild.splash) {
			await newGuild.setSplash(oldGuild.splash, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.banner !== newGuild.banner) {
			await newGuild.setBanner(oldGuild.banner, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
			await newGuild.setVerificationLevel(oldGuild.verificationLevel, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
			await newGuild.setExplicitContentFilter(oldGuild.explicitContentFilter, "Anti-Guild Protection | Settings Restored");
		}
		if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
			await newGuild.setAFKTimeout(oldGuild.afkTimeout, "Anti-Guild Protection | Settings Restored");
		}
	}
}