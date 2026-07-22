import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";


export default class GuildEmojiDelete extends Event {
	// Ultra-fast cache
	private configCache = new Map<string, AntiNuke>();
	private trustedCache = new Map<string, any>();
	private emojiCache = new Map<string, { name: string; url: string }>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.GuildEmojiDelete,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildEmojiDelete, async (emoji) => {
			if (!emoji.guild) return;
			const { guild } = emoji;
			const guildId = guild.id;

			// Cache emoji data immediately
			this.emojiCache.set(emoji.id, {
				name: emoji.name || `emoji-${Date.now()}`,
				url: emoji.imageURL({ size: 2048})
			});

			try {
				// Ultra-fast config check with cache
				let config = this.configCache.get(guildId);
				if (!config) {
					config = await this.client.services.antinukes.getConfig(guildId);
					this.configCache.set(guildId, config);
					setTimeout(() => this.configCache.delete(guildId), 30000);
				}

				const actionConfig = config?.emoji?.find(c => c.type === "delete");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.EmojiDelete
				}).catch(() => null);

				if (!logs) return;
				const log = logs.entries.first();
				if (!log || !log.executor) return;

				const executorId = log.executor.id;
				const now = Date.now();

				// Fast early returns
				if (executorId === guild.ownerId ||
					executorId === this.client.user?.id ||
					executorId === config.admin ||
					(now - log.createdTimestamp) > 120000) return;

				// Ultra-fast trusted user check with cache
				let trustedSet = this.trustedCache.get(guildId);
				if (!trustedSet) {
					trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
					this.trustedCache.set(guildId, trustedSet);
					setTimeout(() => this.trustedCache.delete(guildId), 30000);
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
					this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");
					await guild.emojis.create({
						name: emoji.name || `emoji-${Date.now()}`,
						attachment: emoji.imageURL({ size: 2048 })
					}).catch((err) => {
						this.client.logger?.error?.(`Failed to restore emoji ${emoji.id}: ${err}`);
					});
				}
				const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "emojiDelete", actionConfig);

				if (tracked) {
					this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");
					await guild.emojis.create({
						name: emoji.name || `emoji-${Date.now()}`,
						attachment: emoji.imageURL({ size: 2048 })
					}).catch((err) => {
						this.client.logger?.error?.(`Failed to restore emoji ${emoji.id}: ${err}`);
					});
				}

			} catch (error) {
				this.client.logger?.error?.(error);
				this.emojiCache.delete(emoji.id);
			}
		});
	}
}