import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class WebhooksUpdate extends Event {
	// Ultra-fast cache
	private configCache = new Map<string, AntiNuke>();
	private trustedCache = new Map<string, any>();
	private webhookUpdateCache = new Map<string, { executorId: string, timestamp: number }>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.WebhooksUpdate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.WebhooksUpdate, async (channel) => {
			if (!channel.guild) return;
			const { guild } = channel;
			const guildId = guild.id;

			try {
				// Ultra-fast config check with cache
				let config = this.configCache.get(guildId);
				if (!config) {
					config = await this.client.services.antinukes.getConfig(guildId);
					this.configCache.set(guildId, config);
					setTimeout(() => this.configCache.delete(guildId), 30000);
				}

				const actionConfig = config?.webhook?.find(c => c.type === "update");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.WebhookUpdate
				}).catch(() => null);

				if (!logs) return;
				const log = logs.entries.first();
				if (!log || !log.executor || !log.target) return;

				const executorId = log.executor.id;
				const webhookId = log.target.id;
				const now = Date.now();

				// Check cache for recent webhook updates first
				const cachedUpdate = this.webhookUpdateCache.get(webhookId);
				if (cachedUpdate && (now - cachedUpdate.timestamp) < 120000) {
					return this.handleWebhookUpdate(guild, cachedUpdate.executorId, webhookId, actionConfig);
				}

				// Cache this webhook update for future checks
				this.webhookUpdateCache.set(webhookId, { executorId, timestamp: now });
				setTimeout(() => this.webhookUpdateCache.delete(webhookId), 120000);

				// Fast early returns
				if (executorId === guild.ownerId ||
					executorId === this.client.user?.id ||
					executorId === config.admin ||
					(now - log.createdTimestamp) > 120000) return;

				await this.handleWebhookUpdate(guild, executorId, webhookId, actionConfig);

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}

	private async handleWebhookUpdate(guild: any, executorId: string, webhookId: string, actionConfig: any): Promise<void> {
		try {
			// Ultra-fast trusted user check with cache
			let trustedSet = this.trustedCache.get(guild.id);
			if (!trustedSet) {
				const config = this.configCache.get(guild.id);
				trustedSet = new Set(config?.trustedUsers?.map(u => u.id) || []);
				this.trustedCache.set(guild.id, trustedSet);
				setTimeout(() => this.trustedCache.delete(guild.id), 30000);
			}

			if (trustedSet.has(executorId)) return;

			// Fast member check using cache first
			let member = guild.members.cache.get(executorId) as any;
			if (!member) {
				member = await guild.members.fetch(executorId).catch(() => null);
				if (!member) return;
			}

			if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

			const tracked = await this.client.services.antinukes.trackAction(
				guild,
				executorId,
				"webhookUpdate",
				actionConfig
			);

			if (tracked) {
				await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Webhook Protection | Unauthorized Update"
				);
			}

		} catch (error) {
			this.client.logger?.error?.(error);
		}
	}
}