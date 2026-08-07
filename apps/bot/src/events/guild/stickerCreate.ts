import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";


export default class GuildStickerCreate extends Event {
	private stickerCreateCache = new Map<string, { executorId: string, timestamp: number }>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.GuildStickerCreate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildStickerCreate, async (sticker) => {
			if (!sticker.guild) return;
			const { guild, id: stickerId } = sticker;
			const guildId = guild.id;

			try {
				const config = await this.client.services.antinukes.getConfig(guildId);

				const actionConfig = config?.sticker?.find(c => c.type === "create");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Check cache for recent sticker creations first
				const cachedCreation = this.stickerCreateCache.get(stickerId);
				if (cachedCreation && (Date.now() - cachedCreation.timestamp) < 120000) {
					return this.handleStickerCreation(guild, cachedCreation.executorId, stickerId, actionConfig);
				}

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.StickerCreate
				}).catch(error => {
					this.client.logger?.error?.(error);
					return null;
				});

				if (!logs) return;
				const log = logs.entries.first();
				if (!log || !log.executor) return;

				const executorId = log.executor.id;
				const now = Date.now();

				// Cache this sticker creation for future checks
				this.stickerCreateCache.set(stickerId, { executorId, timestamp: now });
				setTimeout(() => this.stickerCreateCache.delete(stickerId), 120000).unref();

				// Fast early returns
				if (executorId === guild.ownerId ||
					executorId === this.client.user?.id ||
					executorId === config.admin ||
					(now - log.createdTimestamp) > 120000) return;

				await this.handleStickerCreation(guild, executorId, stickerId, actionConfig);

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}

	private async handleStickerCreation(guild: any, executorId: string, stickerId: string, actionConfig: any): Promise<void> {
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
					"Anti-Sticker Protection | Unauthorized Sticker"
				);

				if (enforced) {
					await guild.stickers.delete(
						stickerId,
						"Anti-Sticker Protection | Unauthorized Sticker"
					).catch((error: unknown) => {
						this.client.logger?.error?.(error);
					});
				}
				return;
			}
			const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "stickerCreate", actionConfig);

			if (tracked) {
				const enforced = await this.client.services.antinukes.punishUser(
					guild,
					executorId,
					actionConfig.action,
					"Anti-Sticker Protection | Unauthorized Sticker"
				);

				if (enforced) {
					await guild.stickers.delete(
						stickerId,
						"Anti-Sticker Protection | Unauthorized Sticker"
					).catch((error: unknown) => {
						this.client.logger?.error?.(error);
					});
				}
			}

		} catch (error) {
			this.client.logger?.error?.(error);
		}
	}
}