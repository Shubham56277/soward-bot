import {
	AttachmentBuilder,
	AuditLogEvent,
	ChannelType,
	Collection,
	ContainerBuilder,
	EmbedBuilder,
	Events,
	FileBuilder,
	Guild,
	GuildAuditLogs,
	GuildBasedChannel,
	GuildChannel,
	GuildMember,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageCreateOptions,
	MessageFlags,
	MessagePayload,
	PermissionsBitField,
	SectionBuilder,
	SystemChannelFlagsBitField,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import BaseClient from "../base/Client";
import { AuditLogger } from "@repo/db";
import moment from "moment";
import InvitesTracker from "@androz2091/discord-invites-tracker";

export class AuditLogService {
	constructor(private client: BaseClient) {
		this.start();
	}
	private start() {
		try {
			
		const tracker = InvitesTracker.init(this.client, {
			fetchGuilds: true,
			fetchVanity: true,
			fetchAuditLogs: true,
		});
		
		this.client.on(Events.GuildAuditLogEntryCreate, async (auditLog, guild) => {
			if (!guild) return;
			if (!auditLog) return;
			const logType = this.getLogTypeForAction(auditLog.action);

			const loggerConfig = await AuditLogger.get(guild.id);

			if (!loggerConfig?.enabled) return;

			const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
			if (!logChannel) return;
			const embed = new EmbedBuilder()
				.setColor(this.client.config.colors.main)
				.setTimestamp()
				.setAuthor({ name: `${this.client.user?.username}`, iconURL: this.client.user?.displayAvatarURL() });

			switch (auditLog.action) {
				// ======= CHANNEL =======
				case AuditLogEvent.ChannelDelete: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const channel = target as GuildChannel;
					const regEx = /^🟢｜ticket([+-]?(?=\.\d|\d)(?:\d+)?(?:\.?\d*))(?:[eE]([+-]?\d+))?$/i;
					if (regEx.test(channel.name)) return;

					embed
						.setDescription("🗑️ A channel has been deleted")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Channel Name**",
								value: `${channel?.name} (${channel?.id})`,
								inline: true,
							},
							{
								name: "**Channel Type**",
								value: `${ChannelType[channel?.type]}`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Channel:** (\`${channel?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.ChannelCreate: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const channel = target as GuildChannel;
					const regEx = /^🟢｜ticket([+-]?(?=\.\d|\d)(?:\d+)?(?:\.?\d*))(?:[eE]([+-]?\d+))?$/i;
					if (regEx.test(channel.name)) return;

					embed
						.setDescription("🌱 A channel has been created")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Channel**",
								value: `${channel?.toString()} (\`${channel?.id}\`)`,
								inline: true,
							},
							{
								name: "**Channel Type**",
								value: `${ChannelType[channel?.type]}`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n>`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.ChannelOverwriteCreate:
				case AuditLogEvent.ChannelOverwriteDelete:

				// biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
				case AuditLogEvent.ChannelOverwriteUpdate: {
					const { executor, extra, changes, target } = auditLog;
					let targetType: string = "";
					let typeString: string = "";
					let APerms: string | any[] = [];
					let DPerms: string | any[] = [];
					const extr = extra as any;
					const user = target as any;
					changes.forEach((item, index) => {
						switch (changes[index]!.key) {
							case "allow":
								if (item.new === undefined) {
									item.new = "0";
								}
								APerms = new PermissionsBitField(BigInt(item.new as string)).toArray().filter((x) => !new PermissionsBitField(BigInt(item.old as string)).toArray().includes(x));
								break;

							case "deny":
								if (item.new === undefined) {
									item.new = "0";
								}
								DPerms = new PermissionsBitField(BigInt(item.new as string)).toArray().filter((x) => !new PermissionsBitField(BigInt(item.old as string)).toArray().includes(x));
								break;

							case "id":
								if (changes[index].old === undefined && index === 0) {
									if (!extr?.type) {
										typeString = "Role";
										targetType = `<@&${extr?.id}>`;
										embed.addFields({
											name: "Role",
											value: `<@&${extr?.id}> (${extr?.id}) was added`,
										});
									} else {
										typeString = "User";
										targetType = `<@${extr?.id}>`;
										embed.addFields({
											name: "User",
											value: `<@${extr?.id}> (${extr?.id}) was added`,
										});
									}
								}
								if (changes[index].new === undefined && index === 0) {
									if (!extr?.type) {
										typeString = "Role";
										targetType = `<@&${extr?.id}>`;
										embed.addFields({
											name: "Role",
											value: `<@&${extr?.id}> (${extr?.id}) was removed`,
										});
									} else {
										typeString = "User";
										targetType = `<@${extr?.id}>`;
										embed.addFields({
											name: "User",
											value: `<@${extr?.id}> (${extr?.id}) was removed`,
										});
									}
								}
								break;
						}
					});

					if (changes.length <= 3) {
						let targetVal = `<@${extr?.id}> (${extr?.id})`;
						if (extr) {
							extr.type = 0;
							targetVal = `<@&${extr.id}> (${extr.id})`;
						}
						const targetType = ["Role", "User"];
						embed.addFields({
							name: targetType[extr?.type] || "Unknown",
							value: targetVal,
							inline: true,
						});
					}

					let permString = "";
					if (APerms.length > 0) {
						permString += `**Allowed** ${APerms.toString().replaceAll(",", "\n**Allowed** ")}\n\n`;
					}
					if (DPerms.length > 0) {
						permString += `**Denied** ${DPerms.toString().replaceAll(",", "\n**Denied** ")}`;
					}

					if (permString.length > 0) {
						embed.addFields({
							name: "Permission Changes",
							value: `${permString}`,
						});
					}
					embed.setDescription(`🔄 ${ChannelType[user?.type]} ${targetType} (\`${user?.id}\`) was updated`).setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` });
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
				}
				case AuditLogEvent.ChannelUpdate: {
					const { executor, target, changes } = auditLog;
					if (!executor || !target) return;
					const channel = target as GuildChannel;
					const regEx = /^🟢｜ticket([+-]?(?=\.\d|\d)(?:\d+)?(?:\.?\d*))(?:[eE]([+-]?\d+))?$/i;
					if (regEx.test(channel.name)) return;
					for (const [, value] of Object.entries(changes)) {
						switch (value.key) {
							case "name":
								{
									embed.addFields(
										{
											name: "Old Name",
											value: `\`${value.old ?? "None"}\``,
											inline: true,
										},
										{
											name: "New Name",
											value: `\`${value.new ?? "None"}\``,
											inline: true,
										},
									);
								}
								break;
							case "topic":
								{
									embed.addFields(
										{
											name: "Old Topic",
											value: `\`${value.old ?? "None"}\``,
											inline: true,
										},
										{
											name: "New Topic",
											value: `\`${value.new ?? "None"}\``,
											inline: true,
										},
									);
								}
								break;
							case "bitrate":
								embed.addFields({
									name: "Bitrate",
									value: `Old Bitrate: \`${value.old}\`\nNew Bitrate: \`${value.new}\``,
								});
								break;
							case "user_limit":
								embed.addFields({
									name: "User Limit",
									value: `Old User Limit: \`${value.old}\`\nNew User Limit: \`${value.new}\``,
								});
								break;
							case "position":
								embed.addFields({
									name: "Position",
									value: `Old Position: \`${value.old}\`\nNew Position: \`${value.new}\``,
								});
								break;
							case "archived":
								embed.addFields({
									name: "Archived",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;

							case "nsfw":
								embed.addFields({
									name: "NSFW",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;

							case "rate_limit_per_user":
								embed.addFields({
									name: "Slowmode",
									value: `Old Rate Limit: \`${value.old}\`\nNew Rate Limit: \`${value.new}\``,
								});
								break;

							case "default_auto_archive_duration":
								embed.addFields({
									name: "Thread auto hide interval",
									value: `Old Interval: \`${value.old}\`\nNew Interval: \`${value.new}\``,
								});
								break;

							case "available_tags": {
								const oldTags = new Collection<string, string>();
								// biome-ignore lint/complexity/noForEach: <explanation>
								// biome-ignore lint/complexity/useArrowFunction: <explanation>
								value?.old?.forEach(function (tag) {
									if (tag.emoji_name) {
										oldTags.set(tag.emoji_name, tag.emoji_name);
									} else {
										oldTags.set(`<:emoji:${tag.id}>`, `<:emoji:${tag.id}>`);
									}
								});
								const newTags = new Collection<string, string>();
								// biome-ignore lint/complexity/noForEach: <explanation>
								value?.new?.forEach((tag) => {
									if (tag.emoji_name) {
										newTags.set(tag.emoji_name, tag.emoji_name);
									} else {
										newTags.set(`<:emoji:${tag.id}>`, `<:emoji:${tag.id}>`);
									}
								});
								embed.addFields({
									name: "Tags",
									value: `Old Tags: ${Array.from(oldTags.keys()).toString().replaceAll(",", " ")}\nNew Tags: ${Array.from(newTags.keys()).toString().replaceAll(",", " ")}`,
								});
								break;
							}

							case "default_thread_rate_limit_per_user":
								embed.addFields({
									name: "Thread Rate Limit",
									value: `Old Rate Limit: \`${value.old}\`\nNew Rate Limit: \`${value.new}\``,
								});
								break;

							case "default_reaction_emoji": {
								let oldReactEmoji = "";
								let newReactEmoji = "";
								if (value.old?.emoji_name) {
									oldReactEmoji = value.old.emoji_name;
								} else {
									oldReactEmoji = `<:emoji:${value.old?.emoji_id}>`;
								}
								if (value.old?.emoji_name) {
									newReactEmoji = value.old.emoji_name;
								} else {
									newReactEmoji = `<:emoji:${value.new?.emoji_id}>`;
								}
								embed.addFields({
									name: "Default Reaction Emoji",
									value: `Old Reaction Emoji: ${oldReactEmoji}\nNew Reaction Emoji: ${newReactEmoji}`,
								});
								break;
							}
						}
						embed
							.setDescription(`🔄 ${ChannelType[channel?.type]} ${channel?.name} (\`${channel?.id}\`) was updated`)
							.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` });

						this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					}
					//ChannelPinsUpdate
					break;
				}
				// ======= GUILD =======
				case AuditLogEvent.GuildUpdate: {
					const { executor, target, executorId, changes } = auditLog;
					if (!executor || !target) return;
					const guild = target as Guild;
					for (const [key, value] of Object.entries(changes)) {
						switch (value.key) {
							case "name":
								{
									embed.addFields(
										{
											name: "Old Name",
											value: `\`${value.old ?? "None"}\``,
											inline: true,
										},
										{
											name: "New Name",
											value: `\`${value.new ?? "None"}\``,
											inline: true,
										},
									);
								}
								break;
							case "afk_timeout":
								embed.addFields({
									name: "AFK Timeout",
									value: `Old Timeout: \`${value.old}\`\nNew Timeout: \`${value.new}\``,
								});
								break;

							case "afk_channel_id":
								embed.addFields({
									name: "AFK Channel",
									value: `Old Afk Channel: <@&${value.old}> (${value.old})\nNew Afk Channel: <@&${value.new}> (${value.new})`,
								});
								break;

							case "premium_progress_bar_enabled":
								embed.addFields({
									name: "Boost Progress Bar",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;
							case "system_channel_id":
								embed.addFields({
									name: "System Channel",
									value: `Old System Channel: <@&${value.old}> (${value.old})\nNew System Channel: <@&${value.new}> (${value.new})`,
								});
								break;

							case "system_channel_flags":
								embed.addFields({
									name: "System Channel Flags",
									value: `Old State:\n\`${new SystemChannelFlagsBitField(value.old).toArray().toString().replaceAll(",", "\n")}\`\nNew State:\n\`${new SystemChannelFlagsBitField(value.new).toArray().toString().replaceAll(",", "\n")}\``,
								});
								break;

							case "default_message_notifications": {
								const notificationState = ["All Messages", "Only @mentions"];
								embed.addFields({
									name: "Notification Settings",
									value: `Old State: \`${notificationState[value.old!]}\`\nNew State: \`${notificationState[value.new!]}\``,
								});
								break;
							}

							case "icon_hash":
								embed.addFields({
									name: "Icon",
									value: `Old Server Icon: \`${value.old}\`\nNew Server Icon: \`${value.new}\``,
								});
								break;

							case "banner_hash":
								embed.addFields({
									name: "Icon",
									value: `Old Server Banner: \`${value.old}\`\nNew Server Banner: \`${value.new}\``,
								});
								break;

							case "splash_hash":
								embed.addFields({
									name: "Icon",
									value: `Old Splash Background: \`${value.old}\`\nNew Splash Banner: \`${value.new}\``,
								});
								break;

							case "widget_channel_id":
								embed.addFields({
									name: "Widget Channel",
									value: `Old Widget Channel: <@&${value.old}> (${value.old})\nNew Widget Channel: <@&${value.new}> (${value.new})`,
								});
								break;

							case "widget_enabled":
								embed.addFields({
									name: "Widget Settings",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;

							case "explicit_content_filter": {
								const contentFilter = ["Do not filter", "Filter messages from server members without roles", "Filter messages from all members"];
								embed.addFields({
									name: "Explicit image filter",
									value: `Old State: \`${contentFilter[value.old!]}\`\nNew State: \`${contentFilter[value.new!]}\``,
								});
								break;
							}

							case "vanity_url_code": {
								embed.addFields({
									name: "Vanity URL",
									value: `Old Vanity URL: \`${value.old ?? "None"}\`\nNew Vanity URL: \`${value.new ?? "None"}\``,
								});
								break;
							}
							case "rules_channel_id":
								embed.addFields({
									name: "Rules Channel",
									value: `Old Rules Channel: <@&${value.old}> (${value.old})\nNew Rules Channel: <@&${value.new}> (${value.new})`,
								});
								break;

							case "public_updates_channel_id":
								embed.addFields({
									name: "Updates Channel",
									value: `Old Updates Channel: <@&${value.old}> (${value.old})\nNew Updates Channel: <@&${value.new}> (${value.new})`,
								});
								break;

							case "preferred_locale":
								embed.addFields({
									name: "Preferred Locale",
									value: `Old Preferred Locale: \`${value.old}\`\nNew Preferred Locale: \`${value.new}\``,
								});
								break;

							case "description":
								embed.addFields({
									name: "Community Description",
									value: `Old Description: \`${value.old ?? "None"}\`\nNew Description: \`${value.new ?? "None"}\``,
								});
								break;

							case "verification_level": {
								const verificationLevel = ["Low", "Medium", "High", "Highest"];
								embed.addFields({
									name: "Verification Level",
									value: `Old Verification Level: \`${verificationLevel[value.old!]}\`\nNew Verification Level: \`${verificationLevel[value.new!]}\``,
								});
								break;
							}

							case "mfa_level":
								embed.addFields({
									name: "Moderator 2fa Required",
									value: `Old State: \`${Boolean(value.new)}\`\nNew State: \`${Boolean(value.new)}\``,
								});
								break;
						}
						embed
							.setDescription("🔄 Server settings have been updated")
							.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
							.addFields({
								name: "**IDs**",
								value: `> **Executor:** (\`${executorId}\`)\n> **Server:** (\`${guild.id}\`)`,
								inline: false,
							});

						await this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					}
					break;
				}
				// ======= ROLE =======
				case AuditLogEvent.RoleCreate: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const role = target as any;
					embed
						.setDescription("🌱 A role has been created")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Role**",
								value: `${role?.toString()} (${role?.id})`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.RoleDelete: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const role = target as any;
					embed
						.setDescription("🗑️ A role has been deleted")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Role**",
								value: `${role?.toString()} (${role?.id})`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Role:** (\`${role?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.RoleUpdate: {
					const { executor, target, changes } = auditLog;
					if (!executor || !target) return;
					const role = target as any;
					for (const [key, value] of Object.entries(changes)) {
						switch (value.key) {
							case "name":
								{
									embed.addFields(
										{
											name: "Old Name",
											value: `\`${value.old ?? "None"}\``,
											inline: true,
										},
										{
											name: "New Name",
											value: `\`${value.new ?? "None"}\``,
											inline: true,
										},
									);
								}
								break;
							case "color":
								embed.addFields({
									name: "Color",
									value: `Old Color: \`#${value.old?.toString(16)}\`\nNew Color: \`#${value.new?.toString(16)}\``,
								});
								break;

							case "hoist":
								embed.addFields({
									name: "Hoist",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;

							case "mentionable":
								embed.addFields({
									name: "Mentionable",
									value: `Old State: \`${value.old}\`\nNew State: \`${value.new}\``,
								});
								break;

							case "permissions": {
								const oldPerms = new PermissionsBitField(BigInt(value.old as string)).toArray();
								const newPerms = new PermissionsBitField(BigInt(value.new as string)).toArray();
								const addedPerms = newPerms.filter((perm) => !oldPerms.includes(perm));
								const removedPerms = oldPerms.filter((perm) => !newPerms.includes(perm));

								let permsString = "";
								if (addedPerms.length > 0) {
									permsString += `**Added** ${addedPerms.toString().replaceAll(",", "\n**Added** ")}\n\n`;
								}
								if (removedPerms.length > 0) {
									permsString += `**Removed** ${removedPerms.toString().replaceAll(",", "\n**Removed** ")}`;
								}

								if (permsString.length > 0) {
									embed.addFields({
										name: "Permission Changes",
										value: `${permsString}`,
									});
								}
							}
						}
						embed
							.setDescription(`🔄 Role ${role?.name} (\`${role?.id}\`) was updated`)
							.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
							.addFields({
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Role:** (\`${role?.id}\`)`,
								inline: false,
							});
						this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					}
					break;
				}
				// ======= EMOJI =======
				case AuditLogEvent.EmojiCreate: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const emoji = target as any;
					embed
						.setDescription("🌱 A custom emoji has been created")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Emoji**",
								value: `${emoji?.name} (${emoji?.id})`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Emoji:** (\`${emoji?.id}\`)`,
								inline: false,
							},
						)
						.setThumbnail(emoji.imageURL());
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.EmojiDelete: {
					const { executor, target, createdTimestamp, changes } = auditLog;
					if (!executor || !target) return;
					embed
						.setDescription("🗑️ A custom emoji has been deleted")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Emoji:** (\`${changes[0]?.old}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.EmojiUpdate: {
					const { executor, target, changes } = auditLog;
					if (!executor || !target) return;
					const emoji = target as any;
					embed.setFields(
						{
							name: "Old Name",
							value: `\`${changes[0]?.old ?? "None"}\``,
							inline: true,
						},
						{
							name: "New Name",
							value: `\`${changes[0]?.new ?? "None"}\``,
							inline: true,
						},
						{
							name: "**IDs**",
							value: `> **Executor:** (\`${executor.id}\`)\n> **Emoji:** (\`${emoji?.id}\`)`,
							inline: false,
						},
					);
					embed
						.setDescription(`🔄 Custom emoji ${emoji?.name} (\`${emoji?.id}\`) was updated`)
						.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
						.setThumbnail(emoji.imageURL());
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});

					break;
				}
				// ======= STICKER =======
				case AuditLogEvent.StickerCreate: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const sticker = target as any;
					embed
						.setDescription("🌱 A sticker has been created")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Sticker**",
								value: `${sticker?.name} (${sticker?.id})`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Sticker:** (\`${sticker?.id}\`)`,
								inline: false,
							},
						)
						.setThumbnail(sticker.imageURL());
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.StickerDelete: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const sticker = target as any;
					embed
						.setDescription("🗑️ A sticker has been deleted")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Sticker:** (\`${sticker?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.StickerUpdate: {
					const { executor, target, changes } = auditLog;
					if (!executor || !target) return;
					const sticker = target as any;
					embed.setFields(
						{
							name: "Old Name",
							value: `\`${changes[0]?.old ?? "None"}\``,
							inline: true,
						},
						{
							name: "New Name",
							value: `\`${changes[0]?.new ?? "None"}\``,
							inline: true,
						},
						{
							name: "**IDs**",
							value: `> **Executor:** (\`${executor.id}\`)\n> **Sticker:** (\`${sticker?.id}\`)`,
							inline: false,
						},
					);
					embed
						.setDescription(`🔄 Sticker ${sticker?.name} (\`${sticker?.id}\`) was updated`)
						.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
						.setThumbnail(sticker.imageURL());
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				// ======= WEBHOOK =======
				case AuditLogEvent.WebhookCreate: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const webhook = target as any;
					embed
						.setDescription("🌱 A webhook has been created")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Webhook**",
								value: `[${webhook?.name}](${webhook?.url}) (${webhook?.id})`,
								inline: true,
							},
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Webhook:** (\`${webhook?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.WebhookDelete: {
					const { executor, target, createdTimestamp } = auditLog;
					if (!executor || !target) return;
					const webhook = target as any;
					embed
						.setDescription("🗑️ A webhook has been deleted")
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Created At**",
								value: `<t:${Math.trunc(createdTimestamp / 1000)}:F>`,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Webhook:** (\`${webhook?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				// biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
				case AuditLogEvent.WebhookUpdate: {
					const { executor, target, changes } = auditLog;
					if (!executor || !target) return;
					const webhook = target as any;
					for (const [key, value] of Object.entries(changes)) {
						switch (value.key) {
							case "name":
								{
									embed.addFields(
										{
											name: "Old Name",
											value: `\`${value.old ?? "None"}\``,
											inline: true,
										},
										{
											name: "New Name",
											value: `\`${value.new ?? "None"}\``,
											inline: true,
										},
									);
								}
								break;
							case "channel_id":
								embed.addFields({
									name: "Channel",
									value: `Old Channel: <#${value.old}> (${value.old})\nNew Channel: <#${value.new}> (${value.new})`,
								});
								break;

							case "avatar_hash":
								embed.addFields({
									name: "Avatar",
									value: `Old Avatar: \`${value.old}\`\nNew Avatar: \`${value.new}\``,
								});
								break;

							case "type":
								embed.addFields({
									name: "Type",
									value: `Old Type: \`${value.old}\`\nNew Type: \`${value.new}\``,
								});
								break;
						}
						embed
							.setDescription(`🔄 Webhook ${webhook?.name} (\`${webhook?.id}\`) was updated`)
							.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
							.addFields({
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Webhook:** (\`${webhook?.id}\`)`,
								inline: false,
							});
						this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
						break;
					}
				}
				//GuildMemberRemove
				case AuditLogEvent.MemberKick: {
					const { executor, target, createdTimestamp, reason } = await auditLog;
					if (!executor || !target) return;
					const member = target as GuildMember;
					embed
						.setAuthor({ name: `${member.user.username}`, iconURL: `${member.displayAvatarURL()}` })
						.setDescription(`🥾 <@${member.id}> was kicked by <@${executor.id}>`)
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Reason**",
								value: reason ? reason : "No reason provided",
								inline: false,
							},
							{
								name: "**User Information**",
								value: `${member.user.username} (${member.id}) <@${member.id}>`,
								inline: false,
							},
							{
								name: "**Account Creation Date**",
								value: member.user.createdTimestamp ? `<t:${Math.trunc(member.user.createdTimestamp / 1000)}:F>` : "Unknown",
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Member:** (\`${member?.user.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.MemberBanAdd: {
					const { executor, target, createdTimestamp, reason } = await auditLog;
					if (!executor || !target) return;
					const member = target as GuildMember;
					embed
						.setAuthor({ name: `${member.user.username}`, iconURL: `${member.displayAvatarURL()}` })
						.setDescription(`🔨 <@${member.id}> was banned by <@${executor.id}>`)
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Reason**",
								value: reason ? reason : "No reason provided",
								inline: false,
							},
							{
								name: "**User Information**",
								value: `${member.user.username} (${member.id}) <@${member.id}>`,
								inline: false,
							},
							{
								name: "**Account Creation Date**",
								value: member.user.createdTimestamp ? `<t:${Math.trunc(member.user.createdTimestamp / 1000)}:F>` : "Unknown",
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Member:** (\`${member?.user.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				case AuditLogEvent.MemberBanRemove: {
					const { executor, target, createdTimestamp, reason } = await auditLog;
					if (!executor || !target) return;
					const member = target as GuildMember;
					embed
						.setAuthor({ name: `${member.user.username}`, iconURL: `${member.displayAvatarURL()}` })
						.setDescription(`🪄 <@${member.id}> was unbanned by <@${executor.id}>`)
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Reason**",
								value: reason ? reason : "No reason provided",
								inline: false,
							},
							{
								name: "**User Information**",
								value: `${member.user.username} (${member.id}) <@${member.id}>`,
								inline: false,
							},
							{
								name: "**Account Creation Date**",
								value: member.user.createdTimestamp ? `<t:${Math.trunc(member.user.createdTimestamp / 1000)}:F>` : "Unknown",
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Member:** (\`${member?.user.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				//MemberPrune
				case AuditLogEvent.MemberPrune: {
					const { executor, target, createdTimestamp, reason } = await auditLog;
					if (!executor || !target) return;
					const member = target as GuildMember;
					embed
						.setDescription(`👥 <@${executor.id}> pruned ${target} members`)
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Reason**",
								value: reason ? reason : "No reason provided",
								inline: false,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Member:** (\`${member?.user.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
				//MemberRoleUpdate
				case AuditLogEvent.MemberRoleUpdate: {
					const { executor, target, createdTimestamp, reason } = await auditLog;
					if (!executor || !target) return;
					const member = target as any;
					embed
						.setAuthor({ name: `${member.username}`, iconURL: `${member.displayAvatarURL()}` })
						.setDescription(`👤 <@${member.id}> role updated by <@${executor.id}>`)
						.setFooter({ text: `${executor.username}`, iconURL: `${executor.displayAvatarURL()}` })
						.addFields(
							{
								name: "**Reason**",
								value: reason ? reason : "No reason provided",
								inline: false,
							},
							{
								name: "**User Information**",
								value: `${member.username} (${member.id}) <@${member.id}>`,
								inline: false,
							},
							{
								name: "**Account Creation Date**",
								value: member.createdTimestamp ? `<t:${Math.trunc(member.createdTimestamp / 1000)}:F>` : "Unknown",
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Executor:** (\`${executor.id}\`)\n> **Member:** (\`${member?.id}\`)`,
								inline: false,
							},
						);
					this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
					break;
				}
			}
		});

		this.client.on(Events.MessageDelete, async (message) => {
			if (!message.guild && message.author?.bot) return;

			const guild = message.guild;
			if (!guild) return;
			if (!message.author) return;
			if (message.author?.bot) return;
			const logType = this.getLogTypeForAction(AuditLogEvent.MessageDelete);

			const loggerConfig = await AuditLogger.get(guild.id);

			if (!loggerConfig?.enabled) return;

			const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
			if (!logChannel) return;

			const msgContainer = new ContainerBuilder().setAccentColor(this.client.config.colors.main);
			const section = new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`🗑️ **A message was deleted in <#${message.channel.id}>**\n\n-# Author: <@${message.author?.id}>\n-# Created: <t:${Math.floor(message.createdTimestamp / 1000)}:F>`,
					),
				)
				.setThumbnailAccessory(new ThumbnailBuilder().setURL(`${message.author?.displayAvatarURL()}`));

			const attachments: AttachmentBuilder[] = [];
			if (message.content?.length! > 1024) {
				const logFile = new AttachmentBuilder(Buffer.from(message.content!), { name: `${message.id}.log` });
				attachments.push(logFile);
				section.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Text Contents:** (Attached as file)"));
				msgContainer.addSectionComponents(section);
				msgContainer.addFileComponents(new FileBuilder().setURL(`attachment://${message.id}.log`));
			} else {
				section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Text Contents:**\n${message.content}`));
				msgContainer.addSectionComponents(section);
			}

			if (message.attachments.size > 0 && message.attachments.first()?.contentType !== "audio/ogg") {
				const mGallery = [];
				msgContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Attachments:**"));
				for (const attachment of message.attachments.values()) {
					try {
						const res = await fetch(attachment.url);
						const arrayBuffer = await res.arrayBuffer();
						const buffer = Buffer.from(arrayBuffer);
						const ext = attachment.name?.split(".").pop() || "png";
						const fileName = `${attachment.id}.${ext}`;
						const imgAttachment = new AttachmentBuilder(buffer, { name: fileName });
						attachments.push(imgAttachment);
						mGallery.push(new MediaGalleryItemBuilder().setURL(`attachment://${fileName}`));
					} catch {}
				}
				msgContainer.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...mGallery));
			}
			msgContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`> **Author ID**: (\`${message.author?.id}\`)\n> **Message ID**: (\`${message.id}\`)\n> **Channel ID**: ${message.channel.toString()} (\`${message.channel.id}\`)`,
				),
			);

			this.sendToLogChannel(guild, logChannel, logType, { components: [msgContainer], files: attachments, allowedMentions: { users: [] }, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
		});
		this.client
			.on(Events.MessageBulkDelete, async (messages, channel) => {
				const guild = channel.guild;
				if (!guild) return;
				if (messages.size === 0) return;
				const logType = this.getLogTypeForAction(AuditLogEvent.MessageDelete);

				const loggerConfig = await AuditLogger.get(guild.id);

				if (!loggerConfig?.enabled) return;

				const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
				if (!logChannel) return;

				let format = "";
				for (const [_, message] of messages) {
					format += `${message.author?.tag} (${message.author?.id}) | (${message.author?.displayAvatarURL()}) | ${moment(message.createdTimestamp).utc().format("MMMM Do YYYY, H:mm:ss")}(UTC): ${message.content}\n`;
				}
				const logFile = new AttachmentBuilder(Buffer.from(format), { name: `${messages.first()?.author?.id}.log` });
				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setDescription(`Deleted **${messages.size}** message(s)`)
					.setFooter({ text: this.client.user?.username ?? "", iconURL: this.client.user?.displayAvatarURL() })
					.setTimestamp();

				await this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed], files: [logFile] }).catch(() => {});
			})
			.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
				if (newMessage.author?.bot) return;
				if (!oldMessage.guild || !newMessage.guild) return;
				if (!oldMessage.author || !newMessage.author) return;
				if (oldMessage.author.bot) return;
				if (oldMessage.content === newMessage.content) return; // No content change, no need to log
				if (oldMessage.content === "" && newMessage.content === "") return; // No content change, no need to log
				if (oldMessage.content === newMessage.content && oldMessage.attachments.size === newMessage.attachments.size) return; // No content change, no need to log
				if (newMessage.author.id !== this.client.user?.id && oldMessage.content !== "" && oldMessage.content !== newMessage.content) {
					try {
						const logType = this.getLogTypeForAction(CustomLoggerEvent.MessageUpdate);

						const loggerConfig = await AuditLogger.get(newMessage.guild?.id!);
						if (!loggerConfig?.enabled) return;

						const logChannel = await AuditLogger.getChannelForType(newMessage.guild?.id!, logType);
						if (!logChannel) return;
						const embed = new EmbedBuilder();
						embed.setColor(this.client.config.colors.main);
						embed.setAuthor({ name: `${oldMessage.author?.tag}`, iconURL: `${oldMessage.author?.displayAvatarURL()}` });
						embed.setDescription(`📝 **${oldMessage.author?.tag}** edited a message in <#${oldMessage.channel.id}>`);
						embed.addFields(
							{
								name: "**Channel**",
								value: `<#${oldMessage.channel.id}> (${oldMessage.channel.id})\n[Go to message](${oldMessage?.url})`,
							},
							{
								name: "**Old Message**",
								value: `\`\`\`ansi\n[0;31m- ${oldMessage.content}\`\`\``,
								inline: true,
							},
							{
								name: "**New Message**",
								value: `\`\`\`ansi\n[0;32m+ ${oldMessage.content}\`\`\``,
								inline: true,
							},
							{
								name: "**IDs**",
								value: `> **Author ID**: (\`${oldMessage.author?.id}\`)\n> **Message ID**: (\`${oldMessage.id}\`)`,
								inline: false,
							},
						);

						embed.setTimestamp();
						embed.setFooter({ text: `${this.client.user?.username}`, iconURL: `${this.client.user?.displayAvatarURL()}` });
						await this.sendToLogChannel(newMessage.guild!, logChannel, logType, { embeds: [embed] }).catch(() => {});
					} catch (error) {}
				}
			});

		// ======= GUILD MEMBER =======
		tracker.on("guildMemberAdd", async (member, type, invite) => {
			const guild = member.guild;
			if (!guild) return;
			const logType = this.getLogTypeForAction(CustomLoggerEvent.MemberJoin);

			const loggerConfig = await AuditLogger.get(guild.id);

			if (!loggerConfig?.enabled) return;
			const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
			if (!logChannel) return;
			const embed = new EmbedBuilder()
				.setColor(this.client.config.colors.main)
				.setDescription(`👋 <@${member.user.id}> joined`)
				.setAuthor({ name: `${member.user.tag}`, iconURL: `${member.displayAvatarURL()}` })
				.addFields(
					{
						name: "**Name**",
						value: `${member.user.tag} (${member.user.id}) <@${member.user.id}>`,
						inline: false,
					},
					{
						name: "**Joined At**",
						value: `<t:${Math.trunc(member.joinedTimestamp ?? Date.now() / 1000)}:F>`,
						inline: false,
					},
					{
						name: "**Account Age**",
						value: `**${Math.trunc(Math.ceil(Date.now() - member.user.createdAt.getTime()) / (1000 * 3600 * 24))}** days`,
						inline: true,
					},
					{
						name: "**Member Count**",
						value: `${member.guild.memberCount}`,
						inline: true,
					},
				);
			switch (type) {
				case "normal":
					embed.addFields({ name: "Invite Used", value: invite?.code ? `${invite.code} by ${invite.inviter?.tag || "Unknown"} with ${invite.uses || "?"} uses` : "Unknown", inline: true });
					break;
				case "vanity":
					embed.addFields({ name: "Invite Used", value: `${member.guild.vanityURLCode}`, inline: true });
					break;
				case "unknown":
					embed.addFields({ name: "Invite Used", value: "unknown", inline: true });
					break;
			}
			embed.addFields({
				name: "**IDs**",
				value: `> **Member ID**: (\`${member.user.id}\`)\n> **Guild ID**: (\`${member.guild.id}\`)`,
			});
			embed.setTimestamp();
			embed.setFooter({ text: `${this.client.user?.username}`, iconURL: `${this.client.user?.displayAvatarURL()}` });

			this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
		});

		// ======= GUILD MEMBER UPDATE =======
		this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
			const guild = oldMember.guild;
			if (!guild) return;

			const logType = this.getLogTypeForAction(AuditLogEvent.MemberUpdate);
			if (!logType) return;
			const loggerConfig = await AuditLogger.get(guild.id);
			if (!loggerConfig?.enabled) return;
			const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
			if (!logChannel) return;
			const auditLog = await newMember.guild.fetchAuditLogs({
				limit: 1,
				type: AuditLogEvent.MemberUpdate,
			});
			const auditEntry = await auditLog.entries.first();
			if (!auditEntry) {
				return;
			}
			const { executor, reason } = auditEntry;

			if (oldMember.pending && !newMember.pending) {
				const clear_time = moment.duration(moment().diff(newMember.joinedAt));
				const timeToClear = clear_time.asSeconds() < 60 ? `${Math.round(clear_time.asSeconds())} seconds` : clear_time.humanize();

				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setAuthor({ name: `${newMember.user.tag}`, iconURL: `${newMember.user.displayAvatarURL()}` })
					.setDescription(`🎉 <@${newMember.user.id}> Cleared Onboarding`)
					.setFooter({ text: `${this.client.user?.username}`, iconURL: `${this.client.user?.displayAvatarURL()}` })
					.addFields(
						{
							name: "**Time Taken:**",
							value: timeToClear,
						},
						{
							name: "**ID**",
							value: `> **Member ID**: (\`${newMember.user.id}\`)\n> **Guild ID**: (\`${newMember.guild.id}\`)`,
						},
					)
					.setTimestamp();
				this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
			} else if (oldMember.nickname !== newMember.nickname && executor !== this.client.user) {
				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setAuthor({ name: `${newMember.user.tag}`, iconURL: `${newMember.user.displayAvatarURL()}` })
					.setDescription(`🎉 <@${newMember.user.id}> Nickname Changed`)
					.setFooter({ text: `${this.client.user?.username}`, iconURL: `${this.client.user?.displayAvatarURL()}` })
					.addFields(
						{
							name: "**Old Nickname**",
							value: `${oldMember.nickname || "None"}`,
							inline: true,
						},
						{
							name: "**New Nickname**",
							value: `${newMember.nickname || "None"}`,
							inline: true,
						},
					)
					.setTimestamp();
				return await this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
			}
			if (newMember.isCommunicationDisabled()) {
				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.orange)
					.setAuthor({ name: `${newMember.user.tag}`, iconURL: `${newMember.user.displayAvatarURL()}` })
					.setDescription(`🔇 <@${newMember.user.id}> has been timed out.`)
					.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` })
					.addFields(
						{
							name: "Reason",
							value: `${reason}`,
							inline: true,
						},
						{
							name: "Until",
							value: `<t:${Math.trunc(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`,
							inline: true,
						},
					)
					.setTimestamp();
				await this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
			}
			if (oldMember.roles.cache.difference(newMember.roles.cache).size > 0) {
				const diff = oldMember.roles.cache.difference(newMember.roles.cache);
				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setAuthor({ name: `${newMember.user.tag}`, iconURL: `${newMember.user.displayAvatarURL()}` })
					.setDescription(`🎭 <@${newMember.user.id}> role updated`)
					.setFooter({ text: `${executor?.username}`, iconURL: `${executor?.displayAvatarURL()}` });

				if (newMember.roles.cache.has(diff.first()?.id!)) {
					embed.addFields({
						name: "**Added Role**",
						value: `<@&${diff.first()?.id}>`,
						inline: true,
					});
				} else {
					embed.addFields({
						name: "**Removed Role**",
						value: `<@&${diff.first()?.id}>`,
						inline: true,
					});
				}
				embed.addFields({
					name: "**IDs**",
					value: `> **Executor ID**: (\`${executor?.id}\`)\n> **Member ID**: (\`${newMember.user.id}\`)\n> **Role ID**: (\`${diff.first()?.id}\`)`,
					inline: false,
				});
				await this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
			}
		});

		// ======= GUILD MEMBER REMOVE =======
		this.client.on(Events.GuildMemberRemove, async (member) => {
			const guild = member.guild;
			if (!guild) return;
			const logType = this.getLogTypeForAction(CustomLoggerEvent.MemberLeave);

			const loggerConfig = await AuditLogger.get(guild.id);

			if (!loggerConfig?.enabled) return;

			const logChannel = await AuditLogger.getChannelForType(guild.id, logType);
			if (!logChannel) return;
			const kickLog = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
			const banLog = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
			const checkLog = (log: GuildAuditLogs, type: AuditLogEvent) => {
				const entry = log.entries.first();
				if (!entry) return false;
				const timeDifference = Math.ceil(moment().diff(entry.createdTimestamp, "seconds", true));
				return entry.executor?.id === member.user.id && timeDifference < 10;
			};
			if (!checkLog(kickLog, AuditLogEvent.MemberKick) && !checkLog(banLog, AuditLogEvent.MemberBanAdd)) {
				const embed = new EmbedBuilder()
					.setColor(this.client.config.colors.main)
					.setDescription(`👋 <@${member.user.id}> left the server`)
					.setAuthor({ name: `${member.user.username}`, iconURL: `${member.displayAvatarURL()}` })
					.addFields(
						{
							name: "**User Information**",
							value: `${member.user.username} (${member.user.id}) <@${member.user.id}>`,
							inline: false,
						},
						{
							name: "**Roles**",
							value: member.roles.cache.size ? `\`\`\`${member.roles.cache.map((r) => r.name).join(", ")}\`\`\`` : "No Roles",
							inline: false,
						},
						{
							name: "**Joined At**",
							value: `<t:${Math.trunc(member.joinedTimestamp ?? Date.now() / 1000)}:F>`,
							inline: true,
						},
						{
							name: "**Account Creation Date**",
							value: `<t:${Math.trunc(member.user.createdTimestamp / 1000)}:F>`,
							inline: true,
						},
					);
				embed.addFields({
					name: "**IDs**",
					value: `> **Member ID**: (\`${member.user.id}\`)\n> **Guild ID**: (\`${member.guild.id}\`)`,
				});
				embed.setTimestamp();
				embed.setFooter({ text: `${this.client.user?.username}`, iconURL: `${this.client.user?.displayAvatarURL()}` });

				this.sendToLogChannel(guild, logChannel, logType, { embeds: [embed] }).catch(() => {});
			}
		});
		} catch (error) {

		}
	}

	public async sendToLogChannel(guild: Guild, channelId: string, action: any, options: string | MessagePayload | MessageCreateOptions): Promise<void> {
		try {
			let logChannel = this.client.channels.cache.get(channelId) as GuildBasedChannel | null;

			if (!logChannel) {
				const channel = await guild.channels.fetch(channelId).catch(() => null);
				if (!channel) {
					await AuditLogger.removeChannelAndType(guild.id, channelId, action);
					return;
				}
				logChannel = channel;
			}

			if (logChannel.isTextBased()) {
				await logChannel.send(options);
			}
		} catch (error) {
			console.error(`Failed to send audit log to channel ${channelId}:`, error);
		}
	}

	private getLogTypeForAction(action: AuditLogEvent | string): string {
		if (typeof action === "string") {
			return action;
		}
		switch (action) {
			case AuditLogEvent.MemberUpdate:
			case AuditLogEvent.MemberRoleUpdate:
				return "member_update";
			case AuditLogEvent.RoleCreate:
			case AuditLogEvent.RoleDelete:
			case AuditLogEvent.RoleUpdate:
				return "role_update";
			case AuditLogEvent.ChannelCreate:
			case AuditLogEvent.ChannelDelete:
			case AuditLogEvent.ChannelUpdate:
			case AuditLogEvent.ChannelOverwriteCreate:
			case AuditLogEvent.ChannelOverwriteDelete:
			case AuditLogEvent.ChannelOverwriteUpdate:
				return "channel_update";
			case AuditLogEvent.GuildUpdate:
				return "guild_update";
			case AuditLogEvent.MemberBanAdd:
				return "ban_create";
			case AuditLogEvent.MemberBanRemove:
				return "ban_delete";
			case AuditLogEvent.MemberKick:
				return "member_kick";
			case AuditLogEvent.MemberPrune:
				return "member_prune";
			case AuditLogEvent.MessageBulkDelete:
			case AuditLogEvent.MessagePin:
			case AuditLogEvent.MessageUnpin:
			case AuditLogEvent.MessageDelete:
				return "message_update";
			case AuditLogEvent.EmojiCreate:
			case AuditLogEvent.EmojiDelete:
			case AuditLogEvent.EmojiUpdate:
				return "emoji_update";
			case AuditLogEvent.WebhookCreate:
			case AuditLogEvent.WebhookDelete:
			case AuditLogEvent.WebhookUpdate:
				return "webhook_update";
			case AuditLogEvent.StickerCreate:
			case AuditLogEvent.StickerUpdate:
			case AuditLogEvent.StickerDelete:
				return "sticker_update";
			default:
				return "other";
		}
	}
}

export enum CustomLoggerEvent {
	MemberJoin = "member_join",
	MemberLeave = "member_leave",
	MessageUpdate = "message_update",
}
