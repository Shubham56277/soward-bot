import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, Routes } from "discord.js";

export default class WebhooksUpdate extends Event {
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
				const config = await this.client.services.antinukes.getConfig(guildId);

				const actionConfig = config?.webhook?.find(c => c.type === "create");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.WebhookCreate
				}).catch(error => {
					this.client.logger?.error?.(error);
					return null;
				});

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
				setTimeout(() => this.webhookCache.delete(webhookId), 120000).unref();

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
			if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

			// Fast member check using cache first
			let member = guild.members.cache.get(executorId) as any;
			if (!member) {
				member = await guild.members.fetch(executorId).catch((error: unknown) => {
					this.client.logger?.error?.(error);
					return null;
				});
				if (!member) return;
			}

			if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

			if (actionConfig.limit <= 1) {
				const enforced = await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Webhook Protection | Unauthorized Creation"
				);
				if (enforced) await this.deleteWebhook(guild, webhookId);
				return;
			}
			const tracked = await this.client.services.antinukes.trackAction(
				guild,
				executorId,
				"webhookCreate",
				actionConfig
			);

			if (tracked) {
				const enforced = await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Webhook Protection | Unauthorized Creation"
				);
				if (enforced) await this.deleteWebhook(guild, webhookId);
			}

		} catch (error) {
			this.client.logger?.error?.(error);
		}
	}

	private async deleteWebhook(guild: any, webhookId: string): Promise<void> {
		await guild.client.rest.delete(Routes.webhook(webhookId))
			.catch((error: unknown) => {
				this.client.logger?.error?.(error);
				return guild.fetchWebhooks();
			})
			.then((hooks: any) => hooks?.get?.(webhookId)?.delete()
				.catch((error: unknown) => this.client.logger?.error?.(error)));
	}
}