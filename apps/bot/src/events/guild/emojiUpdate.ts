import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events } from "discord.js";


export default class GuildEmojiUpdate extends Event {
	constructor(client: BaseClient) {
		super(client, {
			event: Events.GuildEmojiUpdate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => {
			if (!newEmoji.guild) return;
			const { guild } = newEmoji;
			const guildId = guild.id;


			try {
				const config = await this.client.services.antinukes.getConfig(guildId);

				const actionConfig = config?.emoji?.find(c => c.type === "update");
				if (!actionConfig?.enabled || !config.enabled) return;

				// Fast audit log fetch
				const logs = await guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.EmojiUpdate
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

					if (enforced && oldEmoji.name !== newEmoji.name) {
						newEmoji.setName(oldEmoji.name || `emoji-${Date.now()}`, "Anti-Emoji Protection").catch(() => {
							this.client.logger?.error?.(`Failed to reset emoji name for ${newEmoji.id} in ${guild.name}`);
						});
					}
					return;
				}
				const tracked = await this.client.services.antinukes.trackAction(guild, executorId, "emojiUpdate", actionConfig);

				if (tracked) {
					const enforced = await this.client.services.antinukes.punishUser(guild, executorId, actionConfig.action, "Anti-Emoji Protection | Not Whitelisted");

					if (enforced && oldEmoji.name !== newEmoji.name) {
						newEmoji.setName(oldEmoji.name || `emoji-${Date.now()}`, "Anti-Emoji Protection").catch(() => {
							this.client.logger?.error?.(`Failed to reset emoji name for ${newEmoji.id} in ${guild.name}`);
						});
					}
				}

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}
}