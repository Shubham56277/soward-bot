import { AutoMod, AutoResponder, VoiceChannelRole, Welcome } from "@repo/db";
import BaseClient from "../base/Client";
import { handleAfk } from "../modules/afk";
import { AntiNukeService } from "../modules/antinuke";
import { SpamDetector } from "../modules/mod/spam";
import { AntiLink } from "../modules/mod/links";
import {
	APIEmbed,
	AttachmentBuilder,
	Events,
	TextChannel,
} from "discord.js";
import { replacePlaceholders } from "../utils/helper";
import { handleRoleAlias } from "../utils/functions/customroleManager";
import { createWelcomeImage } from "../utils/canvas";
import { AuditLogService } from "./auditLogService";
import { TicketModule } from "../modules/ticket";
import { MusicModule } from "../modules/music/buttons";
import { AutoRoleModule } from "../modules/autorole/autorole";
import { messageTracker } from "../modules/MessageTracker";
import { handleMediaMessage } from "../modules/media";
import { RateLimiter } from "../utils/rateLimiter";

const VOICE_STATE_UPDATE_RATE_LIMIT = {
	windowMs: 60 * 1000, // 1 minute window
	max: 30, // Max 30 role updates per minute per user
	keyPrefix: "voice_state_update",
};

export class Services {
	public antinukes: AntiNukeService;
	public links: AntiLink;
	private spamDetector: SpamDetector;
	private logger: AuditLogService;
	constructor(private client: BaseClient) {
		this.antinukes = new AntiNukeService(client);
		this.spamDetector = new SpamDetector(client);
		this.links = new AntiLink(client);
		this.logger = new AuditLogService(client);
		client.on("interactionCreate", async (interaction) => {
			if (interaction.isButton()) {
				const buttonHandler = new TicketModule(interaction);
				await buttonHandler.handle();
				const musicHandler = new MusicModule(interaction);
				await musicHandler.handle();
			}
			if (interaction.isStringSelectMenu() && interaction.customId === "music_similar") {
				const musicHandler = new MusicModule(interaction);
				await musicHandler.handle();
			}
		});
		client.on("guildMemberAdd", async (member) => {
			const autoRole = new AutoRoleModule(member);
			await autoRole.handle();
		});
		client.on(Events.MessageDelete, async (message) => {
			if (!message.guild) return;
			if (message.partial) {
				try {
					message = await message.fetch();
				} catch (error) {
					console.error("Error fetching deleted message:", error);
					return;
				}
			}
			messageTracker.addDeletedMessage(message);
		});
		client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
			if (oldMessage.content === newMessage.content) return;
			if (!newMessage.guild) return;
			if (!oldMessage.guild) return;

			if (oldMessage.partial) {
				try {
					oldMessage = await oldMessage.fetch();
				} catch (error) {
					console.error("Error fetching old message:", error);
					return;
				}
			}

			messageTracker.addEditedMessage(oldMessage, newMessage);
		});
		client.on(Events.MessageCreate, async (m) => {
			if (!m.guild) return;
			const mod = await AutoMod.get(m.guildId!);
			if (!mod.enabled) return;
			if (mod.spam?.enabled) {
				if (!mod.spam.action) return;

				if (m.author.id === m.guild.ownerId) return;

				const memberRoles = m.member?.roles.cache;
				if (mod.spam.ignoredUsers?.some((id) => id.id === m.author.id)) {
					return;
				}
				if (mod.spam.ignoredChannels?.some((id) => id.id === m.channelId)) {
					return;
				}
				if (mod.spam.ignoredRoles?.some((id) => memberRoles?.has(id.id))) {
					return;
				}
				const check = await this.spamDetector.checkSpam(m, mod);

				const { actionRequired, reason, count } = check;
				if (actionRequired) {
					await this.spamDetector.takeAction(m, reason || "Spam detected", count);
				}
			}

			if (mod.link?.enabled) {
				const { link } = mod;
				if (!link.action) return;
				if (m.author.id === m.guild.ownerId) return;

				const memberRoles = m.member?.roles.cache;
				if (link.ignoredUsers?.some((id) => id.id === m.author.id)) {
					return;
				}
				if (link.ignoredChannels?.some((id) => id.id === m.channelId)) {
					return;
				}
				if (link.ignoredRoles?.some((id) => memberRoles?.has(id.id))) {
					return;
				}

				const { blocked, reason } = await this.links.checkMessage(
					m,
					mod,
				);
				if (blocked) {
					await this.links.takeAction(m, reason || "Link detected");
				}
			}
		});
		client.on(Events.MessageCreate, async (message) => {
			await handleMediaMessage(message);
			await handleRoleAlias(message);
			await handleAfk(message);
			if (!message.guild || message.author.bot) return;
			const redis = message.client.redis;
			const cacheKey = `auto_responder:${message.guild.id}`;
			let responders = JSON.parse((await redis.get(cacheKey)) || "null");

			if (!responders) {
				responders = await AutoResponder.getAll(message.guild.id);
				await redis.setex(cacheKey, 300, JSON.stringify(responders));
			}

			for (const entry of responders) {
				if (!entry.enabled) continue;
				if (entry.channelId && entry.channelId !== message.channel.id) {
					continue;
				}

				let match = false;
				function escapeRegex(str: string) {
					return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				}
				if (entry.useRegex) {
					try {
						match = new RegExp(entry.trigger, "i").test(
							message.content,
						);
					} catch (e) {
						continue;
					}
				} else {
					const content = message.content.toLowerCase();
					const trigger = entry.trigger.toLowerCase();
					const wordMatch = new RegExp(
						`\\b${escapeRegex(trigger)}\\b`,
						"i",
					);
					match = wordMatch.test(content);
				}
				if (!match) continue;

				const cooldownKey =
					`cooldown:auto_responder:${message.guild.id}:${entry.trigger}:${message.author.id}`;
				if (await redis.get(cooldownKey)) return;

				await message.channel.send(entry.response);
				await redis.setex(cooldownKey, entry.cooldown, "1");
				break;
			}
		});
		client.on(Events.VoiceStateUpdate, async (oldState, newState) => {

			if (newState.member?.user.bot) return;

			const guildId = newState.guild.id;
			const member = newState.member;
			const userId = member?.id;

			const rateLimiter = new RateLimiter(client.redis);
			if (!member || !userId) return;


			const limit = await rateLimiter.checkRateLimit(
				`${guildId}`,
				VOICE_STATE_UPDATE_RATE_LIMIT,
			);

			if (limit.limited) {
				console.warn(
					`User ${userId} exceeded voice state update rate limit for guild ${guildId}.`,
				);
				return;
			}

			const vcRoles = await VoiceChannelRole.get(guildId);
			if (!vcRoles) return;


			if (!oldState.channelId && newState.channelId) {
				const vcRole = vcRoles.roleId;
				if (!vcRole) return;

				try {
					await member.roles.add(vcRole);
				} catch (error) {
					console.error(
						`Failed to add role ${vcRole} to member ${member.id}:`,
						error,
					);
				}
			} else if (oldState.channelId && !newState.channelId) {
				const vcRole = vcRoles.roleId;
				if (!vcRole) return;

				try {
					await member.roles.remove(vcRole);
				} catch (error) {
					console.error(
						`Failed to remove role ${vcRole} from member ${member.id}:`,
						error,
					);
				}
			}
		});

		// Welcome
		client.on(Events.GuildMemberAdd, async (member) => {
			const welcome = await Welcome.get(member.guild.id);
			if (!welcome) return;
			const channel = member.guild.channels.cache.get(
				welcome.channelId,
			) as TextChannel;
			if (!channel) return;
			try {
				if (welcome.type === "embed") {
					const embed: APIEmbed = {};
					if (welcome.embed) {
						if (welcome.embed.color) embed.color = welcome.embed.color;
						if (welcome.embed.title) {
							embed.title = replacePlaceholders(welcome.embed.title, member, member.guild);
						}
						if (welcome.embed.description) {
							embed.description = replacePlaceholders(welcome.embed.description, member, member.guild);
						}
						if (welcome.embed.author?.name) {
							embed.author = {
								name: replacePlaceholders(welcome.embed.author?.name!, member, member.guild),
							};
							if (welcome.embed.author?.icon_url) {
								embed.author.icon_url = replacePlaceholders(welcome.embed.author?.icon_url, member, member.guild);
							}
						}
						if (welcome.embed.thumbnail && welcome.embed.thumbnail?.url) {
							embed.thumbnail = {
								url: replacePlaceholders(welcome.embed.thumbnail?.url, member, member.guild),
							};
						}
						if (welcome.embed.image && welcome.embed.image?.url) {
							embed.image = {
								url: replacePlaceholders(welcome.embed.image?.url, member, member.guild),
							};
						}
						if ((welcome.embed.footer && welcome.embed.footer.text)) {
							embed.footer = {
								text: replacePlaceholders(welcome.embed.footer.text, member, member.guild),
							};
							if (welcome.embed.footer?.icon_url) {
								embed.footer.icon_url = replacePlaceholders(welcome.embed.footer?.icon_url!, member, member.guild);
							}
						}
						if (welcome.embed.timestamp) {
							embed.timestamp = new Date().toISOString();
						}
					}
					try {
						await channel.send({
							embeds: [embed],
							content: replacePlaceholders(welcome.message, member, member.guild),
						});
					} catch (error) { }
				}
				if (welcome.type === "card") {
					const welcomeMessageText = replacePlaceholders(welcome.message, member, member.guild);

					const buffer = await createWelcomeImage(member, member.guild);
					const attachment = new AttachmentBuilder(buffer, {
						name: "welcome.webp",
					});
					await channel.send({
						content: welcomeMessageText,
						files: [attachment],
					});
				} else if (welcome.type === "text") {
					const welcomeMessageText = replacePlaceholders(welcome.message, member, member.guild);
					await channel.send(welcomeMessageText);
				} else if (welcome.type === "embed-text") {
					const embed: APIEmbed = {};
					if (welcome.embed) {
						if (welcome.embed.color) embed.color = welcome.embed.color;
						if (welcome.embed.title) {
							embed.title = replacePlaceholders(welcome.embed.title, member, member.guild);
						}
						if (welcome.embed.description) {
							embed.description = replacePlaceholders(welcome.embed.description, member, member.guild);
						}
						if (welcome.embed.author?.name) {
							embed.author = {
								name: replacePlaceholders(welcome.embed.author?.name!, member, member.guild),
							};
							if (welcome.embed.author?.icon_url) {
								embed.author.icon_url = replacePlaceholders(welcome.embed.author?.icon_url, member, member.guild);
							}
						}

						if (welcome.embed.color) embed.color = welcome.embed.color;
						if (welcome.embed.thumbnail && welcome.embed.thumbnail?.url) {
							embed.thumbnail = {
								url: replacePlaceholders(welcome.embed.thumbnail?.url, member, member.guild),
							};
						}
						if (welcome.embed.image && welcome.embed.image?.url) {
							embed.image = {
								url: replacePlaceholders(welcome.embed.image?.url, member, member.guild),
							};
						}
						if ((welcome.embed.footer && welcome.embed.footer.text)) {
							embed.footer = {
								text: replacePlaceholders(welcome.embed.footer.text, member, member.guild),
							};
							if (welcome.embed.footer?.icon_url) {
								embed.footer.icon_url = replacePlaceholders(welcome.embed.footer?.icon_url!, member, member.guild);
							}
						}
						if (welcome.embed.timestamp) {
							embed.timestamp = new Date().toISOString();
						}
					}
					const welcomeMessageText = replacePlaceholders(welcome.message, member, member.guild);

					try {
						await channel.send({
							embeds: [embed],
							content: welcomeMessageText,
						});
					} catch (error) { }
				}
			} catch (error) {
				console.error("Error sending welcome message:", error);
			}
		});
	}
}
