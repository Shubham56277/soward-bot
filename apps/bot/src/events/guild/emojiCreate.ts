import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";

export default class GuildEmojiCreate extends Event {
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
				const config = await this.client.services.antinukes.getConfig(guildId);

				const actionConfig = config?.emoji?.find(c => c.type === "create");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.EmojiCreate
				}).catch(error => {
					this.client.logger?.error?.(error);
					return null;
				});

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

				if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

				// Fast member check using cache first
				let member = guild.members.cache.get(executorId) as any;
				if (!member) {
					member = await guild.members.fetch(executorId).catch(error => {
						this.client.logger?.error?.(error);
						return null;
					});
					if (!member) return;
				}

				if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;
				if (actionConfig.limit <= 1) {
					const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");
					if (enforced) {
						await emoji.delete("Anti-Emoji Protection | Emoji Removed").catch(error => {
							this.client.logger?.error?.(error);
						});
					}
					return;
				}
				const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "emojiCreate", actionConfig);

				if (tracked) {
					const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");
					if (enforced) {
						await emoji.delete("Anti-Emoji Protection | Emoji Removed").catch(error => {
							this.client.logger?.error?.(error);
						});
					}
				}

			} catch (error) {
				this.client.logger?.error?.("Error in emoji create event:", error);
			}
		});
	}
}