import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events, GuildChannel } from "discord.js";

export default class MessageCreate extends Event {
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

			try {
				const config = await this.client.services.antinukes.getConfig(guildId);

				const actionConfig = config?.mention;
				if (!actionConfig || !config.enabled) return;

				// Fast early returns
				if (userId === guild.ownerId ||
					userId === this.client.user?.id ||
					userId === config.admin) return;

				if (await this.client.services.antinukes.isBypassed(guild, userId)) return;

				// Whitelisted users bypass this listener before any local rate limiting.
				const rateLimitKey = `${guildId}:${userId}`;
				const now = Date.now();
				const lastAction = this.rateLimitCache.get(rateLimitKey) ?? 0;
				if (now - lastAction < 5000) return;
				this.rateLimitCache.set(rateLimitKey, now);

				// Fast member check using cache first
				let member = guild.members.cache.get(userId) as any;
				if (!member) {
					member = await guild.members.fetch(userId).catch(error => {
						this.client.logger?.error?.(error);
						return null;
					});
					if (!member) return;
				}

				if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;
				if (message.webhookId) {
					message.delete().catch(error => {
						this.client.logger?.error?.(error);
					});
					return;
				}

				const enforced = await this.client.services.antinukes.punishUser(
					guild,
					userId,
					"ban",
					"Anti-Mention Protection | Mass Mention Detected",
				);
				if (!enforced) return;

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
								await channel.bulkDelete(everyoneMessages).catch(error => {
									this.client.logger?.error?.(error);
								});
							}
						}
					} catch (error) {
						this.client.logger?.error?.(error);
					}
				});

				// Lock channel (fire and forget)
				if (channel instanceof GuildChannel) {
					setImmediate(async () => {
						try {
							await channel.permissionOverwrites.edit(guild.roles.everyone, {
								ViewChannel: false,
								SendMessages: false
							});
						} catch (error) {
							this.client.logger?.error?.(error);
						}
					});
				}

			} catch (error) {
				this.client.logger?.error?.(error);
			}
		});
	}
}