import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class GuildEmojiCreate extends Event {
	// Ultra-fast cache
	private configCache = new Map<string, AntiNuke>();
	private trustedCache = new Map<string, any>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.GuildEmojiCreate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildEmojiCreate, async (emoji) => {
			if (!emoji.guild) return;
			const { guild } = emoji;
			const guildId = guild.id;

			try {
				// Ultra-fast config check with cache
				let config = this.configCache.get(guildId);
				if (!config) {
					config = await this.client.services.antinukes.getConfig(guildId);
					this.configCache.set(guildId, config);
					setTimeout(() => this.configCache.delete(guildId), 30000);
				}

				const actionConfig = config?.emoji?.find(c => c.type === "create");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.EmojiCreate
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
					await emoji.delete("Anti-Emoji Protection | Emoji Removed").catch(() => { });
					return;
				}
				const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "emojiCreate", actionConfig);

				if (tracked) {
					this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");
					await emoji.delete("Anti-Emoji Protection | Emoji Removed").catch(() => { });
				}

			} catch (error) {
				this.client.logger?.error?.("Error in emoji create event:", error);
			}
		});
	}
}