import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events, GuildChannel } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class MessageCreate extends Event {
	// Ultra-fast cache
	private configCache = new Map<string, AntiNuke>();
	private trustedCache = new Map<string, any>();
	private rateLimitCache = new Map<string, number>();

	constructor(client: BaseClient) {
		super(client, {
			event: Events.MessageCreate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.MessageCreate, async (message) => {
			if (!message.inGuild()) return;
			const { guild, author, channel } = message;
			const guildId = guild.id;
			const userId = author.id;

			// Fast mention check
			const isMention = message.mentions.everyone ||
				message.content.includes("@everyone") ||
				message.content.includes("@here");
			if (!isMention) return;

			// Rate limiting check
			const now = Date.now();
			const lastAction = this.rateLimitCache.get(userId) || 0;
			if (now - lastAction < 5000) return; // 5 second cooldown
			this.rateLimitCache.set(userId, now);

			try {
				// Ultra-fast config check with cache
				let config = this.configCache.get(guildId);
				if (!config) {
					config = await this.client.services.antinukes.getConfig(guildId);
					this.configCache.set(guildId, config);
					setTimeout(() => this.configCache.delete(guildId), 30000);
				}

				const actionConfig = config?.mention;
				if (!actionConfig || !config.enabled) return;

				// Fast early returns
				if (userId === guild.ownerId ||
					userId === this.client.user?.id ||
					userId === config.admin) return;

				// Ultra-fast trusted user check with cache
				let trustedSet = this.trustedCache.get(guildId);
				if (!trustedSet) {
					trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
					this.trustedCache.set(guildId, trustedSet);
					setTimeout(() => this.trustedCache.delete(guildId), 30000);
				}

				if (trustedSet.has(userId)) return;

				// Fast member check using cache first
				let member = guild.members.cache.get(userId) as any;
				if (!member) {
					member = await guild.members.fetch(userId).catch(() => null);
					if (!member) return;
				}

				if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;
				if (message.webhookId) {
					message.delete().catch(() => { });
					return;
				}

				// Fire punishment immediately without waiting
				await this.client.services.antinukes.punishUser(guild, userId, "ban", "Anti-Mention Protection | Mass Mention Detected");

				// Bulk delete messages (fire and forget)
				setImmediate(async () => {
					try {
						const messages = await channel.messages.fetch({ limit: 100 });
						const everyoneMessages = messages.filter(msg =>
							msg.mentions.everyone ||
							msg.content.includes("@everyone") ||
							msg.content.includes("@here")
						);

						if (everyoneMessages.size > 0) {
							if (channel.isTextBased() && !channel.isThread() && !channel.isDMBased()) {
								await channel.bulkDelete(everyoneMessages).catch(() => { });
							}
						}
					} catch { }
				});

				// Lock channel (fire and forget)
				if (channel instanceof GuildChannel) {
					setImmediate(async () => {
						try {
							await channel.permissionOverwrites.edit(guild.roles.everyone, {
								ViewChannel: false,
								SendMessages: false
							});
						} catch { }
					});
				}

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}
}