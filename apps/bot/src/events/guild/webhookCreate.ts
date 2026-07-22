import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, Routes } from "discord.js";
import { AntiNuke } from "@repo/db";
import { wait } from "../../utils/helper";

export default class WebhooksUpdate extends Event {
	// Ultra-fast cache
	private configCache = new Map<string, AntiNuke>();
	private trustedCache = new Map<string, any>();
	private webhookCache = new Map<string, { executorId: string, timestamp: number }>();

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

				const actionConfig = config?.webhook?.find(c => c.type === "create");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.WebhookCreate
				}).catch(() => null);

				if (!logs) return;
				const log = logs.entries.first();
				if (!log || !log.executor || !log.target) return;

				const executorId = log.executor.id;
				const webhookId = log.target.id;
				const now = Date.now();

				// Check cache for recent webhook creations first
				const cachedCreation = this.webhookCache.get(webhookId);
				if (cachedCreation && (now - cachedCreation.timestamp) < 120000) {
					return this.handleWebhookCreation(guild, cachedCreation.executorId, webhookId, actionConfig);
				}

				// Cache this webhook creation for future checks
				this.webhookCache.set(webhookId, { executorId, timestamp: now });
				setTimeout(() => this.webhookCache.delete(webhookId), 120000);

				// Fast early returns
				if (executorId === guild.ownerId ||
					executorId === this.client.user?.id ||
					executorId === config.admin ||
					(now - log.createdTimestamp) > 120000) return;

				await this.handleWebhookCreation(guild, executorId, webhookId, actionConfig);

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}

	private async handleWebhookCreation(guild: any, executorId: string, webhookId: string, actionConfig: any): Promise<void> {
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

			if (actionConfig.limit <= 1) {
				await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Webhook Protection | Unauthorized Creation"
				)
				await guild.client.rest.delete(Routes.webhook(webhookId))
					.catch(() => guild.fetchWebhooks())
					.then((hooks: any) => hooks.get(webhookId)?.delete()
						.catch(() => { }))
				return;
			}
			const tracked = await this.client.services.antinukes.trackAction(
				guild,
				executorId,
				"webhookCreate",
				actionConfig
			);

			if (tracked) {
				// Fire actions immediat
				await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Webhook Protection | Unauthorized Creation"
				)
				await guild.client.rest.delete(Routes.webhook(webhookId))
					.catch(() => guild.fetchWebhooks())
					.then((hooks: any) => hooks.get(webhookId)?.delete()
						.catch(() => { }))
			}

		} catch (error) {
			this.client.logger?.error?.(error);
		}
	}
}