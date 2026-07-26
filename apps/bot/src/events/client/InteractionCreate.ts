import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { ApplicationCommandType, EmbedBuilder, Events, GuildMember, GuildMemberRoleManager, MessageFlags, PermissionFlagsBits, PermissionsBitField, TextChannel, WebhookClient } from "discord.js";
import Context from "../../lib/Context";
import { env } from "@repo/env";
import { IgnoredChannel, Premium } from "@repo/db";
import { acquireMusicCommandLock, type ReleaseMusicCommandLock } from "../../utils/musicCommandSafety";
import { compactReply } from "../../utils/compactReply";
import { handleInteractionError, ensureAcknowledged } from "../../utils/errorHandler";
import { checkPremium } from "../../utils/premiumCheck";

export default class InteractionCreate extends Event {
	constructor(client: BaseClient) {
		super(client, {
			event: Events.InteractionCreate,
		});
	}

	public async execute(): Promise<any> {
		this.client.on(Events.InteractionCreate, async (interaction) => {
			try {
			if (interaction.isButton()) {
				const { buttons } = this.client;
				const button = buttons.get(interaction.customId);

				try {
					// Unregistered controls can belong to a message collector elsewhere.
					if (!button) return;
					await button.execute?.(interaction);
				} catch (error) {
					await handleInteractionError(this.client, interaction, error, { source: "button", command: interaction.customId });
				}
				return;
			}
			if (interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) {
				const { menus } = this.client;
				const selectMenu = menus.get(interaction.customId);
				// Unregistered menus can belong to a message collector elsewhere.
				if (!selectMenu) return;
				try {
					await selectMenu.execute?.(interaction);
				} catch (error) {
					await handleInteractionError(this.client, interaction, error, { source: "menu", command: interaction.customId });
				}
				return;
			}
			if (!interaction.isCommand() && !interaction.isUserContextMenuCommand() && !interaction.isMessageContextMenuCommand() && !interaction.isAutocomplete() && !interaction.isContextMenuCommand()) {
				return;
			}

			if (!interaction.inCachedGuild()) {
				return;
			}
			const { commandName } = interaction;

			const command = this.client.commands.get(commandName.toLowerCase());
			if (!command) {
				if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => undefined);
				if (interaction.isRepliable()) return safeInteractionReply(interaction, { content: "This command is no longer available.", flags: MessageFlags.Ephemeral });
				return;
			}

			const options = "options" in interaction ? interaction.options.data : [];
			const ctx = new Context(interaction as any, options as any);
			const clientMember = interaction.guild.members.resolve(this.client.user!)!;
			if (!(interaction.inGuild() && interaction.channel?.permissionsFor(clientMember)?.has(PermissionFlagsBits.ViewChannel))) return;
			switch (interaction.commandType) {
				case ApplicationCommandType.ChatInput: {
					const isAutocomplete = interaction.isAutocomplete();

					this.client.logger.info(
						{
							command: {
								name: interaction.commandName,
								type: interaction.type,
							},
							userId: interaction.user.id,
						},
						`Executing ${isAutocomplete ? "autocomplete" : "chatInput command"} ${interaction.commandName}`,
					);
					if (isAutocomplete) {
						// ── Music play autocomplete: SC + AM, unique, language-aware trending ──
						if (
							(interaction.commandName === "music" || interaction.commandName === "play") &&
							interaction.options.getFocused(true).name === "query"
						) {
							const raw = interaction.options.getFocused();
							const query = (raw ?? "").trim();

							const nodes = [...this.client.manager.nodeManager.nodes.values()].filter(n => n.connected);
							if (!nodes.length) return interaction.respond([]).catch(() => undefined);

							try {
								// ── Language detection ───────────────────────────────────────
								// Unicode ranges for Devanagari (Hindi) and other South Asian scripts
								const isHindi = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F]/.test(query);

								// Latin-only input — could be romanised Hindi or English
								// If romanised Hindi keywords detected, treat as Hindi
								const hindiRomanKeywords = [
									"aaj", "kal", "dil", "pyar", "mohabbat", "ishq", "yaar", "zindagi",
									"main", "tere", "meri", "tumhari", "tumhara", "kabhi", "koi",
									"nahi", "hai", "hum", "aap", "raat", "subah", "baarish", "dard",
									"teri", "mera", "tera", "bewafa", "tadap", "intezaar", "shayad",
								];
								const words = query.toLowerCase().split(/\s+/);
								const looksHindi = isHindi || words.some(w => hindiRomanKeywords.includes(w));

								// ── Trending queries when input is empty or very short ────────
								const HINDI_TRENDING = [
									"Kesariya", "Tum Hi Ho", "Raataan Lambiyan", "Tera Ban Jaunga",
									"Dil Chahta Hai", "Ae Dil Hai Mushkil", "Chaiyya Chaiyya",
									"Kal Ho Naa Ho", "Tere Bina", "Humsafar",
								];
								const ENGLISH_TRENDING = [
									"Blinding Lights", "Shape of You", "Stay", "As It Was",
									"Levitating", "Unholy", "Flowers", "Anti-Hero", "Bad Guy",
									"Someone Like You",
								];

								if (query.length < 2) {
									const trending = looksHindi ? HINDI_TRENDING : ENGLISH_TRENDING;
									const suggestions = trending.slice(0, 8).map(name => ({ name, value: name }));
									return interaction.respond(suggestions).catch(() => undefined);
								}

								// ── Live search ───────────────────────────────────────────────
								const searchQuery = looksHindi && !isHindi
									? `${query} hindi song`   // help SC/AM find Hindi romanised queries
									: query;

								const [scRes] = await Promise.allSettled([
									this.client.manager.search(`scsearch:${searchQuery}`, interaction.user),
								]);

								const scTracks = scRes.status === "fulfilled" ? (scRes.value?.tracks ?? []).slice(0, 15) : [];

								// ── Relevance scoring + deduplication ────────────────────────
								const queryLower = searchQuery.toLowerCase().replace(/[^a-z0-9\s]/g, "");
								const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

								function coreTitle(raw: string): string {
									return raw
										.toLowerCase()
										.replace(/\(.*?\)/g, "")
										.replace(/\[.*?\]/g, "")
										.replace(/\bfeat\.?\b.*$/i, "")
										.replace(/\bft\.?\b.*$/i, "")
										.replace(/[-–—|]/g, " ")
										.replace(/\.(mp3|wav|m4a|flac)$/i, "")
										.replace(/\s+/g, " ")
										.trim();
								}

								function relevance(track: any): number {
									const title = (track.info.title ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
									const author = (track.info.author ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
									let score = 0;
									for (const word of queryWords) {
										if (title.includes(word)) score += 3;
										else if (author.includes(word)) score += 1;
									}
									if (title.includes(queryLower)) score += 5;
									if (track.info.duration < 30_000) score -= 2;
									if (/\.(mp3|wav|m4a|flac)$/i.test(track.info.title ?? "")) score -= 3;
									return score;
								}

								const scored = scTracks
									.map(t => ({ track: t, score: relevance(t) }))
									.filter(s => s.score >= 1)
									.sort((a, b) => b.score - a.score);

								const seenCore = new Set<string>();
								const suggestions: { name: string; value: string }[] = [];

								for (const { track } of scored) {
									const title  = track.info.title ?? "";
									const author = track.info.author ?? "";
									const core   = coreTitle(title);

									if (seenCore.has(core)) continue;
									seenCore.add(core);

									const label  = `${title} — ${author}`.slice(0, 100);
									const value  = title.slice(0, 100);

									suggestions.push({ name: label, value });
									if (suggestions.length >= 8) break;
								}

								// Fallback: if strict scoring yielded nothing, show raw top results
								if (suggestions.length === 0) {
									for (const t of scTracks.slice(0, 5)) {
										const title = t.info.title ?? "";
										const author = t.info.author ?? "";
										const core = coreTitle(title);
										if (seenCore.has(core)) continue;
										seenCore.add(core);
										suggestions.push({ name: `${title} — ${author}`.slice(0, 100), value: title.slice(0, 100) });
									}
								}

								return interaction.respond(suggestions).catch(() => undefined);
							} catch (error) {
								this.client.logger.warn(`[autocomplete:${interaction.commandName}] search failed, falling back to empty results`, error);
								return interaction.respond([]).catch(() => undefined);
							}
						}
						return interaction.respond([]).catch(() => undefined);
					} else if (interaction.isChatInputCommand()) {
						if (!interaction.guild || !interaction.channel) return;
						const privateResponse = command.name === "premium" && interaction.options.getSubcommand(false) === "redeem";
						try {
							await interaction.deferReply({ flags: privateResponse ? MessageFlags.Ephemeral : undefined });
						} catch (error) {
							// The interaction token is likely already dead (client-side latency > 3s).
							// Nothing more we can do to acknowledge it — just log with full context.
							await handleInteractionError(this.client, interaction, error, { source: "slash", command: command.name }).catch(() => undefined);
							return;
						}

						// For message context commands, we need to check the message's channel
						const channel = interaction.channel;
						const member = interaction.member;

						const ignoredChannel = await IgnoredChannel.get(interaction.guild.id, channel.id);
						if (ignoredChannel) {
							let canBypass = false;
							if (member && "roles" in member) {
								const roles = member.roles as GuildMemberRoleManager;
								const hasBypassRole = ignoredChannel.unignoreRoles?.some((roleId) => roles.cache.has(roleId));
								const hasBypassUser = ignoredChannel.unignoreUsers?.includes(interaction.user.id);
								if (channel instanceof TextChannel) {
									const managerGuildPermissions = channel.permissionsFor(interaction.user, true);
									canBypass = Boolean(hasBypassRole || hasBypassUser || managerGuildPermissions?.has("ManageGuild"));
								}
							}
							if (!canBypass) return safeInteractionReply(interaction, { content: "Commands are disabled in this channel." });
						}
						if (
							!(
								clientMember.permissions.has(PermissionFlagsBits.ViewChannel) &&
								clientMember.permissions.has(PermissionFlagsBits.SendMessages) &&
								clientMember.permissions.has(PermissionFlagsBits.EmbedLinks) &&
								clientMember.permissions.has(PermissionFlagsBits.ReadMessageHistory)
							)
						) {
							const content = "I need these permissions: View Channel, Send Messages, Embed Links, Read Message History.";
							return safeInteractionReply(interaction, { content }).catch(() => interaction.user.send({ content }).catch(() => undefined));
						}
						if (command.permissions) {
							if (command.permissions?.client) {
								const missingClientPermissions = command.permissions.client.filter((perm: any) => !clientMember.permissions.has(perm));

								if (missingClientPermissions.length > 0) {
									return await safeInteractionReply(interaction, {
										content: `I need the following permissions to run this command: ${missingClientPermissions.map((perm: any) => `\`${perm}\``).join(", ")}`,
										flags: MessageFlags.Ephemeral,
									});
								}
							}
						}
						if (command.permissions?.dev && env.DEVELOPER_IDS) {
							const isDev = env.DEVELOPER_IDS.includes(interaction.user.id);
							if (!isDev) return safeInteractionReply(interaction, { content: "This command is restricted to bot developers." });
						}

						const isDev = env.DEVELOPER_IDS.includes(interaction.user.id);
						if (!isDev) {
							const cooldown = await this.client.commandCooldowns.take(command.name, interaction.user.id, command.cooldown || 5);
							if (!cooldown.allowed) {
								return await safeInteractionReply(interaction, {
									content: `Please wait \`${(cooldown.retryAfterMs / 1_000).toFixed(1)}s\` before reusing \`/${command.name}\`.`,
									flags: MessageFlags.Ephemeral,
								});
							}
						}
						if (command.premium && !isDev && !(await checkPremium(this.client.redis, interaction.user.id, interaction.guild!))) {
							return await safeInteractionReply(interaction, {
								content: "This is a premium command. Use `/premium redeem` with an activation code to unlock it.",
								flags: MessageFlags.Ephemeral,
							});
						}

						if (command.player) {
							if (command.player.voice) {
								if (!(interaction.member instanceof GuildMember)) {
									return safeInteractionReply(interaction, { content: "I could not resolve your server member profile." });
								}
								if (!interaction.member.voice.channel) {
									return await safeInteractionReply(interaction, {
										content: "You need to be in a voice channel to run this command.",
									});
								}

								if (!clientMember.permissions.has(PermissionFlagsBits.Connect)) {
									return await safeInteractionReply(interaction, {
										content: "I need the following permissions to run this command: Connect",
									});
								}

								if (!clientMember.permissions.has(PermissionFlagsBits.Speak)) {
									return await safeInteractionReply(interaction, {
										content: "I need the following permissions to run this command: Connect, Speak",
									});
								}

								const player = this.client.manager.getPlayer(interaction.guildId);
								const activeVoiceChannelId = clientMember.voice.channelId ?? (player?.connected ? player.voiceChannelId : null);
								if (activeVoiceChannelId && activeVoiceChannelId !== interaction.member.voice.channelId) {
									return await safeInteractionReply(interaction, {
										content: `I am already being used in <#${activeVoiceChannelId}>. Join that voice channel to use music commands.`,
										flags: MessageFlags.Ephemeral,
									});
								}
							}

							if (command.player.active) {
								const queue = this.client.manager.getPlayer(interaction.guildId);
								if (!queue?.queue.current) {
									return await safeInteractionReply(interaction, {
										content: "There is no song currently playing.",
									});
								}
							}
						}

						let releaseMusicLock: ReleaseMusicCommandLock | null = null;
						try {
							if (command.category === "music") {
								releaseMusicLock = await acquireMusicCommandLock(this.client.redis, interaction.guildId, interaction.id);
								if (!releaseMusicLock) {
									return await safeInteractionReply(interaction, compactReply({
										content: "Another music command is being processed in this server. Please try again in a moment.",
										flags: MessageFlags.Ephemeral,
									}));
								}
							}
							const result = await command.run?.(ctx, ctx.args);
							if (!ctx.msg) await safeInteractionReply(interaction, { content: "The command completed without a response." });
							return result;
						} catch (error) {
							await handleInteractionError(this.client, interaction, error, { source: "slash", command: command.name });
						} finally {
							await releaseMusicLock?.();
							const hook = env.COMMAND_LOG_WEBHOOK_URL ? new WebhookClient({ url: env.COMMAND_LOG_WEBHOOK_URL }) : null;

							const embed = new EmbedBuilder()
								.setColor(0x000000)
								.setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
								.setDescription("Slash Commad")
								.addFields(
									{ name: "Command", value: `\`${command.name}\`` },
									{ name: "Guild", value: `${interaction.guild.name} (${interaction.guild.id})` },
									{ name: "Channel", value: `${interaction.channel.name} (${interaction.channel.id})` },
									{ name: "User", value: `${interaction.user.username} (${interaction.user.id})` },
									{ name: "Timestamp", value: `<t:${Math.floor(Date.now() / 1000)}:R>` },
									{ name: "Interaction ID", value: interaction.id },
								);

							hook?.send({ embeds: [embed] }).catch((error) => this.client.logger.error("[command-log] Webhook failed", error));
						}
					}
					break;
				}
			}
			if (interaction.isContextMenuCommand()) {
				const { commandName, guild, client } = interaction;

				if (!guild) return;

				const command = client.commands.get(commandName.toLowerCase());

				if (!command) return;

				/** Check if botPermissions */
				if (command.permissions?.client) {
					if (!interaction.guild!.members.me?.permissions.has(command.permissions.client)) {
						return interaction
							.reply({
								content: `Please give me \`${new PermissionsBitField(command.permissions.client).toArray().join("`, `")}\` permission(s) to run this command.`,
								flags: MessageFlags.Ephemeral,
							})
							.catch(() => null);
					}
				}
				if (command.permissions?.user) {
					const user = interaction.member as GuildMember;
					if (!user.permissions.has(command.permissions.user)) {
						return interaction
							.reply({
								content: `You don't have the \`${new PermissionsBitField(command.permissions.user).toArray().join("`, `")}\` permission(s) to run this command.`,
								flags: MessageFlags.Ephemeral,
							})
							.catch(() => null);
					}
				}
				try {
					await command.contextRun?.(interaction);
				} catch (error) {
					await handleInteractionError(this.client, interaction, error, { source: "slash", command: command.name });
				}
			}
			} catch (error) {
				// Last-resort net for anything that slipped past every inner handler above.
				if (interaction.isAutocomplete()) {
					this.client.logger.error(`[interaction:${interaction.id}] Unhandled autocomplete failure`, error);
					return interaction.respond([]).catch(() => undefined);
				}
				if (interaction.isRepliable()) {
					await handleInteractionError(this.client, interaction as any, error, { source: "event" });
				} else {
					this.client.logger.error(`[interaction:${interaction.id}] Unhandled non-repliable interaction failure`, error);
				}
			}
		});
	}
}

async function safeInteractionReply(interaction: any, options: any): Promise<any> {
	const formatted = compactReply(options);
	if (interaction.deferred || interaction.replied) {
		const editOptions = typeof formatted === "string" ? formatted : { ...formatted };
		if (typeof editOptions !== "string") {
			if (typeof editOptions.flags === "number") {
				editOptions.flags &= ~MessageFlags.Ephemeral;
				if (editOptions.flags === 0) delete editOptions.flags;
			} else {
				delete editOptions.flags;
			}
		}
		return interaction.editReply(editOptions).catch(() => interaction.followUp(compactReply({ ...options, flags: MessageFlags.Ephemeral })));
	}
	return interaction.reply(formatted);
}
