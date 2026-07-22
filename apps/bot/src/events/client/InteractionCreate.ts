import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { ApplicationCommandType, EmbedBuilder, Events, GuildMember, GuildMemberRoleManager, MessageFlags, PermissionFlagsBits, PermissionsBitField, TextChannel, WebhookClient } from "discord.js";
import Context from "../../lib/Context";
import { env } from "@repo/env";
import { IgnoredChannel, Premium } from "@repo/db";
import { acquireMusicCommandLock, type ReleaseMusicCommandLock } from "../../utils/musicCommandSafety";
import { compactReply } from "../../utils/compactReply";

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
					this.client.logger.error(error);
					return safeInteractionReply(interaction, { content: "I couldn't complete that action. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
					this.client.logger.error(error);
					return safeInteractionReply(interaction, { content: "I couldn't complete that selection. Please try again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
						return interaction.respond([]).catch(() => undefined);
					} else if (interaction.isChatInputCommand()) {
						if (!interaction.guild || !interaction.channel) return;
						const privateResponse = command.name === "premium" && interaction.options.getSubcommand(false) === "redeem";
						try {
							await interaction.deferReply({ flags: privateResponse ? MessageFlags.Ephemeral : undefined });
						} catch (error) {
							this.client.logger.error(`[command:${command.name}] Failed to acknowledge interaction`, error);
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
						if (command.premium && !isDev && !(await Premium.hasPremium(interaction.user.id))) {
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
							this.client.logger.error(`[command:${command.name}] Execution failed`, error);
							const content = "I couldn't complete that command. The error was contained; please try again in a moment.";
							if (interaction.deferred || interaction.replied) {
								return await interaction.editReply(compactReply({ content, embeds: [], components: [] })).catch(() =>
									interaction.followUp(compactReply({ content, flags: MessageFlags.Ephemeral })).catch(() => undefined),
								);
							}
							return await interaction.reply(compactReply({ content, flags: MessageFlags.Ephemeral })).catch(() => undefined);
						} finally {
							await releaseMusicLock?.();
							const hook = env.COMMAND_LOG_WEBHOOK_URL ? new WebhookClient({ url: env.COMMAND_LOG_WEBHOOK_URL }) : null;

							const embed = new EmbedBuilder()
								.setColor("#FF69B4")
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
					this.client.logger.error(`[context-command:${command.name}] Execution failed`, error);
					return safeInteractionReply(interaction, {
						content: "I couldn't complete that command. Please try again in a moment.",
						flags: MessageFlags.Ephemeral,
					}).catch(() => undefined);
				}
			}
			} catch (error) {
				this.client.logger.error(`[interaction:${interaction.id}] Unhandled interaction failure`, error);
				if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => undefined);
				if (interaction.isRepliable()) {
					return safeInteractionReply(interaction, {
						content: "I couldn't complete that action. The error was contained; please try again.",
						flags: MessageFlags.Ephemeral,
					}).catch(() => undefined);
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
