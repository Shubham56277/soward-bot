import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, EmbedBuilder, Message, MessageFlags, PermissionFlagsBits, TextChannel } from "discord.js";
import BaseClient from "../base/Client";
import { Ticket, TicketConfig } from "@repo/db";
import { wait } from "../utils/helper";
import { env } from "@repo/env";
import cron from "node-cron";

// every 72 hours delete all closed tickets
const job = cron.schedule("0 0 * * *", async () => {
	const tickets = await Ticket.getAllClosedTickets();
	if (!tickets) {
		return;
	}
	// is tickets closed 72 hours ago
	const closedTickets = tickets.filter((ticket) => {
		const closedAt = ticket.closedAt;
		if (!closedAt) {
			return false;
		}
		const now = new Date();
		const diff = now.getTime() - closedAt.getTime();
		const hours = diff / (1000 * 60 * 60);
		return hours >= 72;
	});
	if (closedTickets.length === 0) {
		return;
	}
	for (const ticket of closedTickets) {
		await Ticket.delete(ticket.id);
	}
});
job.start();

export class TicketModule {
	private client: BaseClient;
	private interaction: ButtonInteraction;
	constructor(interaction: ButtonInteraction) {
		this.interaction = interaction;
		this.client = interaction.client as BaseClient;
	}
	public async handle() {
		const { customId } = this.interaction;
		
		try {
			switch (customId) {
				case "create_ticket":
					await this.handleCreateTicket();
					break;
				case "claim_ticket":
					this.handleClaimTicket();
					break;
				case "unclaim_ticket":
					this.handleUnclaimTicket();
					break;
				case "close_ticket":
					await this.handleCloseTicket();
					break;
				case "delete_ticket_channel":
					await this.handleDeleteTicketChannel();
					break;
				case "transcript_ticket":
					await this.handleTranscriptTicket();
					break;
			}
		} catch (error) {
			this.client.logger.error("Error in ticket module", error);
		}
	}
	private async handleClaimTicket() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ticket = await Ticket.getTicketByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!ticket) {
			return this.interaction.editReply({
				content: "Ticket not found.",
			});
		}
		const channel = this.interaction.guild?.channels.cache.get(ticket.channelId) as TextChannel;
		const member = await this.interaction.guild?.members.fetch(this.interaction.user.id);
		if (!member) {
			return;
		}
		let canClaim = false;
		if (member.permissions.has(PermissionFlagsBits.Administrator)) {
			canClaim = true;
		}
		const data = await TicketConfig.getAllByGuildId(this.interaction.guildId!);
		if (!data) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		const config = data.find((config) => config.id === ticket.connectionId);

		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		if (config.supportRoles.some((role) => member.roles.cache.has(role))) {
			canClaim = true;
		}
		if (!canClaim) {
			return this.interaction.editReply({
				content: "You do not have permission to claim this ticket.",
			});
		}
		if (ticket.claimedBy) {
			return this.interaction.editReply({
				content: "This ticket is already claimed.",
			});
		}
		const claimedBy = ticket.claimedBy ? ticket.claimedBy : this.interaction.user.id;
		await Ticket.updateClaimedBy(ticket.id, claimedBy);

		try {
			// Prepare all permission updates at once
			const permissionUpdates = [];

			// 1. Remove all support role accesses
			for (const roleId of config.supportRoles) {
				permissionUpdates.push({
					id: roleId,
					deny: [PermissionFlagsBits.ViewChannel], // Or use delete: true if you want to completely remove
				});
			}

			// 2. Set permissions for claiming member
			permissionUpdates.push({
				id: this.interaction.user.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
			});

			// 3. Ensure ticket creator keeps access
			permissionUpdates.push({
				id: ticket.userId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
			});

			// 4. Block everyone else
			permissionUpdates.push({
				id: this.interaction.guild!.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
			});

			// Execute all permission updates in a single API call
			await channel.edit({
				permissionOverwrites: permissionUpdates,
			});
		} catch {}

		// replace the claim button with a unclaim button
		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger));
		if (config.supportRoles.length > 0) {
			buttons.addComponents(new ButtonBuilder().setCustomId("unclaim_ticket").setLabel("Unclaim Ticket").setStyle(ButtonStyle.Primary));
		}
		if (!config.messageId) {
			return;
		}
		const message = await channel.messages.fetch(this.interaction.message.id);
		if (!message) {
			return;
		}
		const embed = message.embeds[0];
		if (!embed) {
			return;
		}
		const newEmbed = new EmbedBuilder(embed.data)
			.setTitle(`Ticket #${ticket.ticketNumber}`)
			.setDescription("Support will be with you shortly. Please describe your issue in detail.")
			.setFields({ name: "Created by", value: `<@${this.interaction.user.id}> (\`${this.interaction.user.id}\`)`, inline: true }, { name: "Status", value: "Open", inline: true })
			.setColor(this.client.config.colors.main)
			.setFooter({
				text: `Ticket ID: ${ticket?.id} | Claimed by: ${this.interaction.user.username}`,
			});

		await message
			.edit({
				embeds: [newEmbed],
				components: [buttons],
			})
			.catch(() => {});
		await this.interaction.editReply({
			content: `Successfully claimed ticket #${ticket.ticketNumber}`,
		});
	}

	private async handleUnclaimTicket() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ticket = await Ticket.getTicketByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!ticket) {
			return this.interaction.editReply({
				content: "Ticket not found.",
			});
		}
		const channel = this.interaction.channel as TextChannel;
		const member = await this.interaction.guild?.members.fetch(this.interaction.user.id);
		if (!member) {
			return;
		}
		//  onkly claim if the user is the one who claimed the ticket
		if (ticket.claimedBy && ticket.claimedBy !== this.interaction.user.id) {
			return this.interaction.editReply({
				content: "You are not the one who claimed this ticket.",
			});
		}
		const data = await TicketConfig.getAllByGuildId(this.interaction.guildId!);
		if (!data) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		const config = data.find((config) => config.id === ticket.connectionId);
		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		if (ticket.claimedBy) {
			await Ticket.updateClaimedBy(ticket.id, null);
		}

		// remove user permissions from the channel
		await channel.permissionOverwrites.delete(this.interaction.user.id).catch((err) => {
			this.client.logger.error("Error removing user permissions", err);
		});
		try {
			// Prepare all permission updates at once
			const permissionUpdates = [];

			// 1. allow all support role accesses
			for (const roleId of config.supportRoles) {
				permissionUpdates.push({
					id: roleId,
					allow: [PermissionFlagsBits.ViewChannel], // Or use delete: true if you want to completely remove
				});
			}

			// 2. Set permissions for everyone
			permissionUpdates.push({
				id: this.interaction.guild!.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
			});

			// 3. Ensure ticket creator keeps access
			permissionUpdates.push({
				id: ticket.userId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
			});

			await channel.edit({
				permissionOverwrites: permissionUpdates,
			});
		} catch {}

		// replace the claim button with a unclaim button
		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger));
		if (config.supportRoles.length > 0) {
			buttons.addComponents(new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Primary));
		}
		if (!config.messageId) {
			return;
		}

		const message = await channel.messages.fetch(config.messageId).catch(() => {});

		if (!message) {
			return;
		}
		const embed = message.embeds[0];
		if (!embed) {
			return;
		}
		const newEmbed = new EmbedBuilder(embed.data)
			.setTitle(`Ticket #${ticket.ticketNumber}`)
			.setDescription("Support will be with you shortly. Please describe your issue in detail.")
			.setFields({ name: "Created by", value: `<@${this.interaction.user.id}> (\`${this.interaction.user.id}\`)`, inline: true }, { name: "Status", value: "Open", inline: true })
			.setColor(this.client.config.colors.main)
			.setFooter({
				text: `Ticket ID: ${ticket?.id}`,
			});
		await message
			.edit({
				embeds: [newEmbed],
				components: [buttons],
			})
			.catch(() => {});
		await this.interaction.editReply({
			content: `Successfully unclaimed ticket #${ticket.ticketNumber}`,
		});
	}
	private async handleCreateTicket() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const config = await TicketConfig.getByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}

		let tickets = await Ticket.getUserTickets(this.interaction.user.id);
		if (tickets) {
			tickets = tickets.filter((ticket) => ticket.status === "open");
			if (tickets.length >= config.openLimit) {
				return this.interaction.editReply({
					content: `You already have ${tickets.length} open tickets. You can only have ${config.openLimit} open tickets at once.`
				})
			}
		}
	
		const permissions = [
			{
				id: this.interaction.guild!.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel],
			},
			{
				id: this.interaction.user.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
			},
		];

		const supportRole = this.interaction.guild?.roles.cache.find((role) => config.supportRoles.includes(role.id));
		if (supportRole) {
			permissions.push({
				id: supportRole.id,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
			});
		}
		const ticketNumber = await Ticket.getNextTicketNumber(this.interaction.guildId!);
		const ticketNumberString = String(ticketNumber).padStart(4, "0");

		const channel = await this.interaction.guild!.channels.create({
			name: `ticket-#${ticketNumberString}`,
			type: ChannelType.GuildText,
			parent: config.openCategoryId,
			permissionOverwrites: permissions,
		});
		const ticket = await Ticket.create({
			guildId: this.interaction.guildId!,
			userId: this.interaction.user.id,
			ticketNumber: ticketNumber,
			channelId: channel.id,
			connectionId: config.id,
			topic: `Ticket created by ${this.interaction.user.username}`,
		});
		const embed = new EmbedBuilder()
			.setTitle(`Ticket #${ticketNumberString}`) // Use the auto-incremented number
			.setDescription("Support will be with you shortly. Please describe your issue in detail.")
			.addFields({ name: "Created by", value: `<@${this.interaction.user.id}> (\`${this.interaction.user.id}\`)`, inline: true }, { name: "Status", value: "Open", inline: true })
			.setColor(this.client.config.colors.main)
			.setFooter({
				text: `Ticket ID: ${ticket?.id}`,
			});
		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger));
		if (config.supportRoles.length > 0) {
			buttons.addComponents(new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Primary));
		}

		await channel
			.send({
				embeds: [embed],
				content: `<@${this.interaction.user.id}>`,
				components: [buttons],
			})
			.catch(() => {});
		return await this.interaction.editReply({
			content: `Ticket created: <#${channel.id}>`,
		});
	}
	private async handleCloseTicket() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ticket = await Ticket.getTicketByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!ticket) {
			return this.interaction.editReply({
				content: "Ticket not found.",
			});
		}
		const channel = this.interaction.channel as TextChannel;
		const member = await this.interaction.guild?.members.fetch(this.interaction.user.id);
		if (!member) {
			return;
		}
		const data = await TicketConfig.getAllByGuildId(this.interaction.guildId!);
		if (!data) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		const config = data.find((config) => config.id === ticket.connectionId);
		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		let canClose = false;
		if (member.permissions.has(PermissionFlagsBits.Administrator)) {
			canClose = true;
		}
		if (config.supportRoles.some((role) => member.roles.cache.has(role))) {
			canClose = true;
		}
		if (ticket.userId === this.interaction.user.id) {
			canClose = true;
		}
		if (ticket.claimedBy && ticket.claimedBy === this.interaction.user.id) {
			canClose = true;
		}

		if (!canClose) {
			return this.interaction.editReply({
				content: "You do not have permission to close this ticket.",
			});
		}
		if (ticket.status === "closed") {
			return this.interaction.editReply({
				content: "This ticket is already closed.",
			});
		}
		const confim = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_close_ticket").setLabel("Confirm").setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId("cancel_close_ticket").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);
		const embed = new EmbedBuilder()
			.setTitle("Are you sure?")
			.setDescription("Are you sure you want to close this ticket? This action cannot be undone.")
			.setColor(this.client.config.colors.main)
			.setFooter({
				text: `Ticket ID: ${ticket?.id}`,
			});
		await this.interaction.editReply({
			content: "Are you sure you want to close this ticket? This action cannot be undone.",
			embeds: [embed],
			components: [confim],
		});
		const message = await this.interaction.fetchReply();
		const collector = message.createMessageComponentCollector({
			filter: (i) => i.user.id === this.interaction.user.id,
			time: 15_000,
		});
		collector.on("collect", async (i) => {
			if (i.customId === "confirm_close_ticket") {
				await Ticket.update({
					id: ticket.id,
					closedBy: i.user.id,
					closedAt: new Date(),
					status: "closed",
				});
				// message for deleting the channel or not
				const deleteChannel = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId("delete_ticket_channel").setLabel("Delete Channel").setStyle(ButtonStyle.Danger),
					new ButtonBuilder().setCustomId("transcript_ticket").setLabel("Transcript").setStyle(ButtonStyle.Primary),
				);
				const embed = new EmbedBuilder()
					.setTitle("Ticket Closed")
					.setDescription("This ticket has been closed. Please let us know if you need further assistance.")
					.setColor(this.client.config.colors.main)
					.setFooter({
						text: `Ticket ID: ${ticket?.id}`,
					});
				await i.deferUpdate();
				await channel.send({
					embeds: [embed],
					components: [deleteChannel],
				});
			} else if (i.customId === "cancel_close_ticket") {
				await i.update({
					content: "Ticket close cancelled.",
					embeds: [],
					components: [],
				});
				collector.stop();
			}
		});
	}
	private async handleDeleteTicketChannel() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ticket = await Ticket.getTicketByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!ticket) {
			return this.interaction.editReply({
				content: "Ticket not found.",
			});
		}
		const channel = this.interaction.channel as TextChannel;

		const member = await this.interaction.guild?.members.fetch(this.interaction.user.id);
		if (!member) {
			return;
		}

		const data = await TicketConfig.getAllByGuildId(this.interaction.guildId!);
		if (!data) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		const config = data.find((config) => config.id === ticket.connectionId);
		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		let canDelete = false;
		if (member.permissions.has(PermissionFlagsBits.Administrator)) {
			canDelete = true;
		}
		if (config.supportRoles.some((role) => member.roles.cache.has(role))) {
			canDelete = true;
		}
		if (ticket.userId === this.interaction.user.id) {
			canDelete = true;
		}
		if (ticket.claimedBy && ticket.claimedBy === this.interaction.user.id) {
			canDelete = true;
		}
		if (!canDelete) {
			return this.interaction.editReply({
				content: "You do not have permission to delete this ticket.",
			});
		}
		if (ticket.status === "open") {
			return this.interaction.editReply({
				content: "This ticket is still open. Please close the ticket before deleting the channel.",
			});
		}

		await this.interaction.editReply({
			content: "This channel deletion has been scheduled. The channel will be deleted in 5 seconds.",
		});

		wait(5_000).then(async () => {
			await channel.delete("[Ticket Closed] Channel deleted").catch(() => {});
		});
	}
	private async handleTranscriptTicket() {
		if (!this.interaction.replied) await this.interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ticket = await Ticket.getTicketByChannelId(this.interaction.guildId!, this.interaction.channelId!);
		if (!ticket) {
			return this.interaction.editReply({
				content: "Ticket not found.",
			});
		}
		const channel = this.interaction.channel as TextChannel;
		const transcript = await TicketModule.buildTranscript(channel);
		// save to the database
		await Ticket.update({
			id: ticket.id,
			transcript: JSON.stringify(transcript),
		});
		//NEXT_PUBLIC_BASE_URL
		const baseUrl = env.NEXT_PUBLIC_BASE_URL;
		const button = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("View Transcript").setURL(`${baseUrl}/transcript/${ticket.id}`).setStyle(ButtonStyle.Link));

		const embed = new EmbedBuilder()
			.setTitle("Transcript")
			.setDescription("The transcript has been generated. Click the button below to view it.")
			.setColor(this.client.config.colors.main)
			.setFooter({
				text: `Ticket ID: ${ticket?.id}`,
			});
		await channel.send({
			embeds: [embed],
			components: [button],
		});
		// send to user dm
		const user = await this.interaction.guild?.members.fetch(ticket.userId);
		
		const data = await TicketConfig.getAllByGuildId(this.interaction.guildId!);
		const config = data.find((config) => config.id === ticket.connectionId);
		if (!config) {
			return this.interaction.editReply({
				content: "Ticket system is not configured for this server.",
			});
		}
		if (config.loggerChannelId) {
			const loggerChannel = this.interaction.guild?.channels.cache.get(config.loggerChannelId) as TextChannel;

			const embed = new EmbedBuilder()
				.setTitle(`Ticket #${ticket.ticketNumber} Closed`)
				.setDescription(
					[
						`**ID:** \`${ticket.id}\``,
						`**Guild:** ${this.interaction.guild?.name}`,
						`**Creator:** <@${ticket.userId}>`,
						`**Closed By:** <@${ticket.closedBy}>`,
						`**Created At:** <t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`,
						`**Closed At:** <t:${Math.floor(ticket.closedAt!.getTime() / 1000)}:F>`,
						`**Transcript:** [View Transcript](${baseUrl}/transcript/${ticket.id})`,
						`**Channel:** <#${ticket.channelId}>`,
					].join("\n"),
				)
				.setColor(this.client.config.colors.main);

			await loggerChannel
				.send({
					embeds: [embed],
					components: [button],
				})
				.catch(() => {});
		}
		if (!user) {
			return;
		}
		await this.interaction.deferUpdate();
		await user.send({
			embeds: [
				new EmbedBuilder()
					.setTitle("Transcript")
					.setDescription("The transcript has been generated. Click the button below to view it.")
					.setColor(this.client.config.colors.main)
					.setFooter({
						text: `Ticket ID: ${ticket?.id}`,
					}),
			],
			components: [button],
		});
		
	}
	private static async fetchAllMessages(channel: TextChannel): Promise<Message[]> {
		let messages: Message[] = [];
		let lastId: string | undefined;

		while (true) {
			const fetched = await channel.messages.fetch({
				limit: 100,
				...(lastId && { before: lastId }),
			});

			if (fetched.size === 0) break;

			messages = messages.concat(Array.from(fetched.values()));
			lastId = fetched.last()?.id;
		}

		// Sort by creation date (oldest first)
		return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
	}

	private static async buildTranscript(channel: TextChannel): Promise<{ messages: any[] }> {
		const messages = await TicketModule.fetchAllMessages(channel);
		const transcript: TranscriptMessage[] = messages.map((message) => {
			const embed = message?.embeds[0]?.data;
			const attachments = message.attachments.map((attachment) => ({
				id: attachment.id,
				url: attachment.url,
				filename: attachment.name,
				size: attachment.size,
			}));
			return {
				server: {
					id: message.guild?.id,
					name: message.guild?.name,
					icon_url: message.guild?.iconURL(),
				},
				id: message.id,
				content: message.content,
				timestamp: message.createdAt.toISOString(),
				author: {
					id: message.author.id,
					username: message.author.username,
					discriminator: message.author.discriminator,
					avatar: message.author.avatarURL(),
				},
				embeds: embed
					? [
							{
								author: {
									name: embed.author?.name,
									url: embed.author?.url,
									icon_url: embed.author?.icon_url,
								},
								url: embed.url,
								image: {
									url: embed?.image?.url,
								},
								thumbnail: {
									url: embed.thumbnail?.url,
								},
								title: embed.title,
								description: embed.description,
								color: embed.color,
								fields:
									embed.fields?.map((field) => ({
										name: field.name,
										value: field.value,
										inline: field.inline,
									})) || [],
								footer: {
									text: embed.footer?.text,
									icon_url: embed.footer?.icon_url,
								},
							},
						]
					: [],
				attachments,
			};
		});
		return { messages: transcript };
	}
}

interface TranscriptMessage {
	server:
		| {
				id: string | null | undefined;
				name: string | null | undefined;
				icon_url: string | null | undefined;
		  }
		| null
		| undefined;
	id: string;
	content: string | null | undefined;
	timestamp: string;
	author: {
		id: string | null | undefined;
		username: string | null | undefined;
		discriminator: string | null | undefined;
		avatar: string | null | undefined;
	};
	embeds:
		| {
				author: {
					name: string | null | undefined;
					url: string | null | undefined;
					icon_url: string | null | undefined;
				};
				title: string | null | undefined;
				description: string | null | undefined;
				color: number | null | undefined;
				url: string | null | undefined;
				image: {
					url: string | null | undefined;
				} | null;
				thumbnail: {
					url: string | null | undefined;
				} | null;
				footer: {
					text: string | null | undefined;
					icon_url: string | null | undefined;
				} | null;
				fields: {
					name: string | null | undefined;
					value: string | null | undefined;
					inline: boolean | null | undefined;
				}[];
		  }[]
		| null;

	attachments:
		| {
				id: string | null | undefined;
				url: string | null | undefined;
				filename: string | null | undefined;
				size: number | null | undefined;
		  }[]
		| null;
}
