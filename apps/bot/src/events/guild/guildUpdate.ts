import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class GuildUpdate extends Event {
	// Enhanced caching with TTL
	private configCache = new Map<string, { config: AntiNuke; expires: number }>();
	private trustedCache = new Map<string, { users: Set<string>; expires: number }>();
	private guildSettingsCache = new Map<string, { settings: any; expires: number }>();
	private CACHE_TTL = 30000; // 30 seconds

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
				// Parallelize initial checks
				const [config, logs] = await Promise.all([
					this.getConfig(guildId),
					newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null)
				]);

				// Fast path: return early if no action needed
				const actionConfig = config?.guild?.find(c => c.type === "update");
				if (!actionConfig?.enabled || !config?.enabled || !logs) return;

				const log = logs.entries.first();
				if (!log?.executor) return;

				const executorId = log.executor.id;
				const now = Date.now();

				// Ultra-fast permission checks
				if (this.shouldSkipAction(newGuild, executorId, config, now, log.createdTimestamp)) {
					return;
				}

				// Check if user is trusted (cached)
				if (await this.isTrustedUser(guildId, executorId, config)) {
					return;
				}

				// Check moderation permissions (cached member lookup)
				if (!await this.canModerate(newGuild, executorId)) {
					return;
				}
				if (actionConfig.limit <= 1) {
					await this.client.services.antinukes.punishUser(
						newGuild,
						executorId,
						actionConfig.action,
						"Anti-Guild Protection | Not Whitelisted",
					);
					this.updateGuild(oldGuild, newGuild).catch(error => {
						this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
					});
					return;
				}
				// Track action and handle punishment in parallel
				const tracked = await this.client.services.antinukes.trackAction(
					newGuild,
					executorId,
					"guildUpdate",
					actionConfig
				);

				if (tracked) {
					await this.client.services.antinukes.punishUser(
						newGuild,
						executorId,
						actionConfig.action,
						"Anti-Guild Protection | Not Whitelisted",
					);
					this.updateGuild(oldGuild, newGuild).catch(error => {
						this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
					});
				}

			} catch (error) {
				this.client.logger?.error?.(`GuildUpdate Error: ${error}`);
				this.guildSettingsCache.delete(guildId);
			}
		});
	}

	private async getConfig(guildId: string): Promise<AntiNuke | undefined> {
		// Check cache first
		const cached = this.configCache.get(guildId);
		if (cached && cached.expires > Date.now()) {
			return cached.config;
		}

		// Fetch fresh config
		const config = await this.client.services.antinukes.getConfig(guildId);
		if (config) {
			this.configCache.set(guildId, {
				config,
				expires: Date.now() + this.CACHE_TTL
			});
		}
		return config;
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

	private async isTrustedUser(guildId: string, executorId: string, config: AntiNuke): Promise<boolean> {
		// Check cache first
		const cached = this.trustedCache.get(guildId);
		if (cached && cached.expires > Date.now()) {
			return cached.users.has(executorId);
		}

		// Build fresh trusted set
		const trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
		this.trustedCache.set(guildId, {
			users: trustedSet,
			expires: Date.now() + this.CACHE_TTL
		});

		return trustedSet.has(executorId);
	}

	private async canModerate(guild: any, executorId: string): Promise<boolean> {
		// Check cache first
		let member = guild.members.cache.get(executorId);
		if (!member) {
			member = await guild.members.fetch(executorId).catch(() => null);
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