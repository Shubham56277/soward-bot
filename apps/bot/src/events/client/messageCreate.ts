import { ChannelType, EmbedBuilder, Events, GuildMember, Message, MessageFlags, PermissionFlagsBits, PermissionResolvable, WebhookClient } from "discord.js";
import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Premium } from "@repo/db";
import Context from "../../lib/Context";
import { env } from "@repo/env";
import { sendCommandHelp } from "../../utils/helper";
import { isCommandIgnored } from "../../utils/functions/ignore";
import { acquireMusicCommandLock, type ReleaseMusicCommandLock } from "../../utils/musicCommandSafety";
import { compactReplyText } from "../../utils/compactReply";
import { getCachedNoPrefix, getCachedPrefix, getCachedPrefixes } from "../../utils/commandStateCache";
import { splitDiscordMessage, type AiRequestResult, type AiScope } from "../../service/aiService";
import type { RagResult } from "../../service/ragService";
import { aiChannelQueue } from "../../queues";
import { LEGACY_COMMANDS_BY_NAME, replacementArguments, replacementRoot, type LegacyCommandMapping } from "../../config/legacyCommandMap";
import { handleMessageError } from "../../utils/errorHandler";
import { checkPremium } from "../../utils/premiumCheck";
import { handleGwfCommand } from "../../lib/giveaways/gwfHandler";

export default class MessageCreate extends Event {
	constructor(client: BaseClient) {
		super(client, {
			event: Events.MessageCreate,
		});
	}

	public async execute(): Promise<any> {
		let DokdoHandler: any = null;
		if (env.NODE_ENV === "development") {
			const DokdoModule: any = await import("dokdo").catch(() => null);
			const DokdoClient = DokdoModule?.Client ?? DokdoModule?.default?.Client ?? null;
			if (DokdoClient) {
				DokdoHandler = new DokdoClient(this.client, {
					aliases: ["dokdo", "dok"],
					owners: env.DEVELOPER_IDS,
					prefix: ".",
					noPerm: (message) => message.reply("You have no permission to use dokdo."),
					globalVariable: { WONDER_IS_COOL: true },
				});
				this.client.logger.info("Dokdo developer tooling enabled (development mode).");
			}
		} else {
			this.client.logger.info("Dokdo developer tooling disabled (production mode).");
		}
		this.client.on(this.event, async (message: Message) => {
			try {
			if (message.author.bot) return;
			if (!(message.guild && message.guildId)) return;

			// Handle .gwf commands (guaranteed winners) — silent for non-developers
			if (message.content.startsWith(".gwf")) {
				const handled = await handleGwfCommand(message, this.client);
				if (handled) return;
			}

			const [configuredPrefixes, noPrefix] = await Promise.all([
				getCachedPrefixes(this.client, message.guildId),
				getCachedNoPrefix(message.author.id),
			]);
			const configuredPrefix = configuredPrefixes[0] ?? await getCachedPrefix(this.client, message.guildId);
			let prefix = configuredPrefix;
			if (noPrefix && !configuredPrefixes.some((candidate) => message.content.startsWith(candidate))) prefix = "";

			const mention = new RegExp(`^<@!?${this.client.user?.id}>( |)$`);
			if (mention.test(message.content)) {
				if (await isCommandIgnored(message)) {
					return message
						.reply({
							content: "Commands are disabled in this channel.",
						})
						.then((msg) => setTimeout(() => msg.delete().catch(() => { }), 5000))
						.catch(() => { });
				}
				const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
				const botName = this.client.user?.username || "Elfaria";
				const container = new ContainerBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`## ${botName}`),
					)
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`A powerful multi-purpose Discord bot built for modern servers.\n\nGet started with \`${prefix}help\` to explore all commands, or invite me to your own server.`,
						),
					)
					.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
					.addActionRowComponents(
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setLabel("Commands")
								.setStyle(ButtonStyle.Secondary)
								.setCustomId("mention_help_noop")
								.setDisabled(true),
							new ButtonBuilder()
								.setLabel("Invite")
								.setStyle(ButtonStyle.Link)
								.setURL(this.client.config.links.invite),
							new ButtonBuilder()
								.setLabel("Support")
								.setStyle(ButtonStyle.Link)
								.setURL(this.client.config.links.supportServer),
						),
					);
				await message.reply({
					components: [container],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
				});
				return;
			}

			const mentionPrefix = new RegExp(`^<@!?${this.client.user?.id}>\\s*`);
			const wasMentioned = mentionPrefix.test(message.content);
			const mentionText = wasMentioned ? message.content.replace(mentionPrefix, "").trim() : "";
			const firstWord = (wasMentioned ? mentionText : message.content).trim().split(/\s+/, 1)[0]?.toLowerCase() || "";
			const isKnownCommand = this.client.commands.has(firstWord);
			const aiControlAction = wasMentioned ? mentionText.split(/\s+/, 1)[0]?.toLowerCase() : "";
			const aiControl = wasMentioned && ["start", "stop", "status", "reset"].includes(aiControlAction);
			const canBeSessionMessage = !wasMentioned
				&& !configuredPrefixes.some((candidate) => message.content.startsWith(candidate))
				&& !(noPrefix && isKnownCommand);
			const aiScope: AiScope = { guildId: message.guildId, channelId: message.channelId, userId: message.author.id };
			const activeAiSession = canBeSessionMessage ? await this.client.ai.isSessionActive(aiScope) : false;
			// Channel sessions apply to everyone — check regardless of mention or prefix
			const activeChannelSession = await this.client.ai.isChannelSessionActive(message.guildId, message.channelId);

			// Channel session: intercept ALL messages (except commands with prefix) and route to AI
			if (activeChannelSession && !aiControl) {
				let question = wasMentioned ? mentionText : message.content.trim();
				// Bare mention with no text → treat as greeting
				if (wasMentioned && !question) question = "hey";
				// Skip only empty messages
				if (!question) return;

				try {
					const cooldownKey = `ai:cooldown:${message.guildId}:${message.author.id}`;
					const onCooldown = await this.client.redis.exists(cooldownKey);
					if (onCooldown) return;
					await this.client.redis.set(cooldownKey, "1", "EX", 7);

					if ("sendTyping" in message.channel) await message.channel.sendTyping().catch(() => {});

					await aiChannelQueue.add("ai-reply", {
						guildId: message.guildId,
						channelId: message.channelId,
						userId: message.author.id,
						messageId: message.id,
						question,
					});
				} catch {}
				return;
			}

			if ((wasMentioned && !isKnownCommand) || aiControl || activeAiSession) {
				if (await isCommandIgnored(message)) return;

				// Premium check for non-channel-session AI usage
				const isDev = env.DEVELOPER_IDS.includes(message.author.id);
				if (!isDev && !(await checkPremium(this.client.redis, message.author.id, message.guild))) {
					return message.reply({
						content: "AI conversations are a premium feature. Use `/premium redeem` with an activation code to unlock them.",
						allowedMentions: { parse: [], repliedUser: false },
						flags: MessageFlags.SuppressNotifications,
					});
				}

				if (aiControl) {
					if (aiControlAction === "start" || aiControlAction === "stop") {
						if (!env.DEVELOPER_IDS.includes(message.author.id)) {
							return message.reply({
								content: "-# Only developers can start or stop AI channels.",
								allowedMentions: { parse: [], repliedUser: false },
								flags: MessageFlags.SuppressNotifications,
							});
						}
					}

					if (aiControlAction === "start") {
						// Parse optional channel mention: @elfaria start <#123456>
						const channelMention = mentionText.match(/<#(\d+)>/);
						const targetChannelId = channelMention ? channelMention[1]! : message.channelId;
						await this.client.ai.startChannelSession(message.guildId, targetChannelId);
						const response = targetChannelId === message.channelId
							? "**AI channel session active.**\n-# All messages in this channel will get AI responses."
							: `**AI channel session active in <#${targetChannelId}>.**\n-# All messages in that channel will get AI responses.`;
						return message.reply({ content: response, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications });
					}
					if (aiControlAction === "stop") {
						await this.client.ai.stopChannelSession(message.guildId, message.channelId);
						return message.reply({
							content: "**AI channel session stopped.**\n-# The channel-wide AI session was removed.",
							allowedMentions: { parse: [], repliedUser: false },
							flags: MessageFlags.SuppressNotifications,
						});
					}
					if (aiControlAction === "reset") await this.client.ai.resetHistory(aiScope);
					const active = aiControlAction === "status" ? await this.client.ai.isSessionActive(aiScope) : false;
					const response = aiControlAction === "reset"
						? "**AI history cleared.**\n-# Your temporary conversation context was removed."
						: `**AI conversation ${active ? "active" : "stopped"}.**\n-# ${active ? "Send messages here, or mention me with a question." : "Mention me with a question or use \`/ai start\`."}`;
					return message.reply({ content: response, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications });
				}

				const question = wasMentioned ? mentionText : message.content.trim();
				if (question) {
					if ("sendTyping" in message.channel) await message.channel.sendTyping().catch(() => undefined);
					const useHistory = activeAiSession || (wasMentioned && await this.client.ai.isSessionActive(aiScope));
					const result = await this.client.rag.ask({ scope: aiScope, question, useHistory });
					return sendAiMessageResult(message, result);
				}
			}

			const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			const acceptedPrefixes = noPrefix && prefix === "" ? ["", ...configuredPrefixes] : configuredPrefixes;
			const prefixAlternatives = acceptedPrefixes
				.filter((candidate, index, values) => values.indexOf(candidate) === index)
				.sort((a, b) => b.length - a.length)
				.map(escapeRegex)
				.join("|");
			const prefixRegex = new RegExp(`^(<@!?${this.client.user?.id}>|${prefixAlternatives})\\s*`);
			if (prefixRegex.test(message.content)) {
				const match = message.content.match(prefixRegex);
				if (!match) return;
				const [matchedPrefix] = match;
				const args = message.content.slice(matchedPrefix.length).trim().split(/ +/g);
				const cmd = args.shift()?.toLowerCase();
				if (!cmd) return;
				let legacyMapping: LegacyCommandMapping | undefined;
				let command = this.client.commands.get(cmd) || this.client.commands.get(this.client.aliases.get(cmd)!);
				if (!command) {
					const mapping = LEGACY_COMMANDS_BY_NAME.get(cmd);
					const replacementCommand = mapping ? this.client.commands.get(replacementRoot(mapping.replacement)) : undefined;
					if (mapping?.prefixCompatibility && replacementCommand) {
						legacyMapping = mapping;
						command = replacementCommand;
						args.unshift(...replacementArguments(mapping.replacement));
					}
				}
				if (command) {
					if (await isCommandIgnored(message)) {
						return message
							.reply({
								content: "Commands are disabled in this channel.",
							})
							.then((msg) => setTimeout(() => msg.delete().catch(() => { }), 5000))
							.catch(() => { });
					}
					const ctx = new Context(message, args);

					const clientMember = message.guild.members.resolve(this.client.user!)!;
					const isDev = env.DEVELOPER_IDS?.includes(message.author.id);
					
					if (!(message.inGuild() && message.channel.permissionsFor(clientMember)?.has(PermissionFlagsBits.ViewChannel))) return;

					if (
						!(
							clientMember.permissions.has(PermissionFlagsBits.ViewChannel) &&
							clientMember.permissions.has(PermissionFlagsBits.SendMessages) &&
							clientMember.permissions.has(PermissionFlagsBits.EmbedLinks) &&
							clientMember.permissions.has(PermissionFlagsBits.ReadMessageHistory)
						)
					) {
						return await message.author
							.send({
								content: "I need the following permissions to run commands: View Channel, Send Messages, Embed Links, Read Message History",
							})
							.catch(() => {
								null;
							});
					}

					const now = Date.now();
					const cooldownAmount = command.cooldown || 5;

					if (!isDev) {
						// Global per-user rate limit: max 5 commands per 10 seconds
						const globalRateKey = `cooldown:global:${message.author.id}`;
						const globalCount = await this.client.redis.incr(globalRateKey).catch(() => 0);
						if (globalCount === 1) {
							await this.client.redis.expire(globalRateKey, 10).catch(() => undefined);
						}
						if (globalCount > 5) {
							return; // Silently drop — user is spamming commands
						}

						const cooldown = await this.client.commandCooldowns.take(command.name, message.author.id, cooldownAmount);
						if (!cooldown.allowed) {
							// Only notify once per cooldown window — silently drop all subsequent spam
							const notifiedKey = `cooldown:notify:${command.name}:${message.author.id}`;
							const alreadyNotified = await this.client.redis.get(notifiedKey).catch(() => null);
							if (!alreadyNotified) {
								await this.client.redis.set(notifiedKey, "1", "PX", cooldown.retryAfterMs).catch(() => undefined);
								await message.reply({
									content: `Please wait \`${(cooldown.retryAfterMs / 1_000).toFixed(1)}s\` before reusing \`${matchedPrefix}${command.name}\`.`,
								}).catch(() => undefined);
							}
							return;
						}
					}

					if (command.permissions) {
						if (command.permissions?.client) {
							const missingClientPermissions = command.permissions.client.filter((perm: any) => !clientMember.permissions.has(perm));

							if (missingClientPermissions.length > 0) {
								return await message.reply({
									content: `Missing client permissions: ${missingClientPermissions.map((perm: PermissionResolvable) => `\`${perm}\``).join(", ")}`,
								});
							}
						}

						if (command.permissions?.user) {
							if (!(isDev || message.member!.permissions.has(command.permissions.user))) {
								return await message.reply({
									content: `Missing user permissions: ${command.permissions.user.map((perm: PermissionResolvable) => `\`${perm}\``).join(", ")}`,
								});
							}
						}

						if (command.permissions?.dev && env.DEVELOPER_IDS) {
							if (!isDev) return;
						}
					}

					if (command.premium && !isDev && !(await checkPremium(this.client.redis, message.author.id, message.guild))) {
						return await message.reply({
							content: `This is a premium command. Use \`${matchedPrefix}premium redeem <code>\` to activate access.`,
						});
					}

					if (command.player) {
						if (command.player.voice) {
							if (!message.member?.voice.channel) {
								return await message.reply({
									content: "You must be in a voice channel to use this command.",
								});
							}

							if (!clientMember.permissions.has(PermissionFlagsBits.Connect)) {
								return await message.reply({
									content: "I need the Connect permission to join your voice channel.",
								});
							}

							if (!clientMember.permissions.has(PermissionFlagsBits.Speak)) {
								return await message.reply({
									content: "I need the Speak permission to join your voice channel.",
								});
							}

							if ((message.member as GuildMember).voice.channel?.type === ChannelType.GuildStageVoice && !clientMember.permissions.has(PermissionFlagsBits.RequestToSpeak)) {
								return await message.reply({
									content: "I need the Request to Speak permission to join your voice channel.",
								});
							}

							const player = this.client.manager.getPlayer(message.guildId);
							const activeVoiceChannelId = clientMember.voice.channelId ?? (player?.connected ? player.voiceChannelId : null);
							if (activeVoiceChannelId && activeVoiceChannelId !== (message.member as GuildMember).voice.channelId) {
								return await message.reply({
									content: `I am already being used in <#${activeVoiceChannelId}>. Join that voice channel to use music commands.`,
								});
							}
						}

						if (command.player.active) {
							const queue = this.client.manager.getPlayer(message.guildId);
							if (!queue?.queue.current) {
								return await message.reply({
									content: "There is no song currently playing.",
								});
							}
						}
					}
					if (command.args && args.length === 0 && !message.reference) {
						await sendCommandHelp(message, command); // sendCommandHelp
						return;
					}

					let releaseMusicLock: ReleaseMusicCommandLock | null = null;
					try {
						if (command.category === "music") {
							releaseMusicLock = await acquireMusicCommandLock(this.client.redis, message.guildId, message.id);
							if (!releaseMusicLock) {
								return await message.reply(compactReplyText("Another music command is being processed in this server. Please try again in a moment."));
							}
						}
						const result = await command.run?.(ctx, ctx.args);
						if (legacyMapping) await this.client.commandDeprecations.notifyMessage(message, legacyMapping);
						return result;
					} catch (error: any) {
						await handleMessageError(this.client, message, error, { source: "prefix", command: command.name });
					} finally {
						await releaseMusicLock?.();
						const hook = env.COMMAND_LOG_WEBHOOK_URL ? new WebhookClient({ url: env.COMMAND_LOG_WEBHOOK_URL }) : null;

						const embed = new EmbedBuilder()
							.setColor(0x000000)
							.setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
							.setDescription("Message Commad")
							.addFields(
								{ name: "Command", value: `\`${command.name}\`` },
								{ name: "Guild", value: `${message.guild.name} (${message.guild.id})` },
								{ name: "Channel", value: `${message.channel.name} (${message.channel.id})` },
								{ name: "User", value: `${message.author.username} (${message.author.id})` },
								{ name: "Timestamp", value: `<t:${Math.floor(Date.now() / 1000)}:R>` },
								{ name: "Message ID", value: message.id },
							);

						hook?.send({ embeds: [embed] }).catch((error) => this.client.logger.error("[command-log] Webhook failed", error));
					}
				}
			}
			if (DokdoHandler && message.content.startsWith(".")) await DokdoHandler.run(message);
			} catch (error) {
				await handleMessageError(this.client, message, error, { source: "event" });
			}
		});
	}
}

async function sendAiMessageResult(message: Message, result: AiRequestResult | RagResult): Promise<any> {
	if (!result.ok) {
		const errors = {
			busy: "Another AI request is already running. Try again in a moment.",
			rate_limited: `The AI request limit was reached. Try again in ${result.retryAfter ?? 60} seconds.`,
			not_configured: "No AI provider is configured. The bot owner must add an AI API key and restart the bot.",
			unavailable: "Every configured AI provider is temporarily unavailable. Try again shortly.",
		};
		return message.reply({ content: `**AI unavailable.**\n-# ${errors[result.reason]}`, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications });
	}

	const chunks = splitDiscordMessage(result.answer.text);
	const first = chunks.shift() || "No response was returned.";
	const latency = result.answer.cached ? "cache" : `${(result.answer.latencyMs / 1_000).toFixed(2)}s`;
	await message.reply({
		content: `${first}\n-# Elfaria · ${latency}`,
		allowedMentions: { parse: [], repliedUser: false },
		flags: MessageFlags.SuppressNotifications,
	});
	for (const chunk of chunks) {
		if (message.channel.isSendable()) await message.channel.send({ content: chunk, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressNotifications });
	}
}
