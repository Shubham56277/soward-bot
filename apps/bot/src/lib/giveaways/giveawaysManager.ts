import { Giveaway } from "@repo/db";
import Context from "../Context";
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, MessageEditOptions, MessageFlags } from "discord.js";
import BaseClient from "../../base/Client";
import { createGiveawayQueue } from "./queue/giveawayQueue";
import Redis from "ioredis";


export interface GiveawaysManagerOptions {
	duration: number;
	prize: string;
	winnerCount: number;
	channel: string;
}


const ACTIVE_JOBS_KEY = 'giveaway:active_jobs';

export class giveawaysManager {
	static async create(ctx: Context, options: GiveawaysManagerOptions) {
		const { duration, prize, winnerCount, channel } = options;

		const sendChannel = await ctx.guild.channels.fetch(channel);
		if (!sendChannel) {
			ctx.editOrReply("Channel not found");
			return;
		}
		if (sendChannel.type !== 0) {
			ctx.editOrReply("Channel must be a text channel");
			return;
		}
		const giveawayEmbed = new EmbedBuilder()
			.setTitle(prize)
			.setDescription(
				`Ends: <t:${Math.floor((Date.now() + duration) / 1000)}:R> (<t:${Math.floor((Date.now() + duration) / 1000)}>)\nHosted by: ${ctx.author?.toString()}\nEntries: \`0\`\nWinners: \`${winnerCount}\``,
			)
			.setColor(ctx.client.config.colors.main)
			.setTimestamp();

		const button = new ButtonBuilder().setCustomId("giveaway_join").setEmoji("<:featured_seasonal_and_gifts_200d:1367474029556138045>").setStyle(ButtonStyle.Secondary);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
		const message = await sendChannel.send({ embeds: [giveawayEmbed], components: [row] });

		await Giveaway.create({
			channelId: sendChannel.id,
			duration: duration,
			prize: prize,
			winners: winnerCount,
			hostedBy: ctx.author?.id!,
			guildId: ctx.guild.id,
			endAt: new Date(Date.now() + duration),
			messageId: message.id,
			ended: false,
		});

		// Create unique job ID and track it in Redis
		const jobId = `${ctx.guild.id}-${message.id}`;
		const queue = createGiveawayQueue(ctx.client);

		await queue.add(
			"endGiveaway",
			{
				guildId: ctx.guild.id,
				messageId: message.id,
			},
			{
				delay: duration,
				jobId: jobId, // Use unique job ID
			},
		);

		// Track the active job in Redis with expiration
		const expirationTime = Math.floor((Date.now() + duration) / 1000) + 300; // 5 minutes buffer
		await ctx.client.redis.hset(ACTIVE_JOBS_KEY, jobId, expirationTime);

		return message;
	}

	static async end(client: BaseClient, guildId: string, messageId: string) {
		// Create job ID for tracking
		const jobId = `${guildId}-${messageId}`;

		// Use Redis to prevent race conditions with distributed lock
		const lockKey = `giveaway:lock:${jobId}`;
		const lockValue = Date.now().toString();
		const lockAcquired = await client.redis.set(lockKey, lockValue, 'PX', 5000, 'NX'); // 5 second lock

		if (!lockAcquired) {
			// Another instance is already processing this giveaway
			console.log(`Giveaway ${jobId} is already being processed by another instance`);
			return;
		}

		try {
			// Use atomic operation to prevent race conditions
			const giveaway = await Giveaway.get(guildId, messageId);
			if (!giveaway) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			// Double-check if already ended (race condition prevention)
			if (giveaway.ended) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			if (giveaway.paused) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			// Immediately mark as ended in database to prevent other instances
			try {
				await Giveaway.update(guildId, messageId, { ...giveaway, ended: true });
			} catch (error) {
				// If update fails, another instance might have already ended it
				console.error("Failed to update giveaway as ended:", error);
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			const channel = await client.channels.fetch(giveaway.channelId);
			if (!channel || channel.type !== 0) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			const message = await channel.messages.fetch(messageId);
			if (!message) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			const embed = message.embeds[0]?.data;
			if (!embed) {
				await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
				return;
			}

			const newEmbed = new EmbedBuilder(embed);
			let content: string;

			if (giveaway.participants?.length) {
				const winnersCount = Math.min(giveaway.winners, giveaway.participants.length);
				const winners = pickRandom(giveaway.participants, winnersCount);

				newEmbed.setDescription(
					`Ends: <t:${Math.floor((Date.now() + giveaway.duration) / 1000)}:R> (<t:${Math.floor((Date.now() + giveaway.duration) / 1000)}>)\nHosted by: ${client.users.cache.get(giveaway.hostedBy)?.toString()}\nEntries: \`${giveaway.participants.length}\`\nWinners: ${winners.map(w => `<@${w.id}>`).join(", ")}`,
				);

				if (winners.length === 1) {
					content = `Congrats <@${winners[0]!.id}>! You won **${giveaway.prize}**, Hosted by <@${giveaway.hostedBy}>.`;
				} else {
					content = `Congrats ${winners.map((u) => `<@${u.id}>`).join(", ")}! You won **${giveaway.prize}**, Hosted by <@${giveaway.hostedBy}>.`;
				}
			} else {
				newEmbed.setDescription(
					`Ends: <t:${Math.floor((Date.now() + giveaway.duration) / 1000)}:R> (<t:${Math.floor((Date.now() + giveaway.duration) / 1000)}>)\nHosted by: ${client.users.cache.get(giveaway.hostedBy)?.toString()}\nEntries: \`0\`\nWinners: None`,
				);
				content = `No one entered this giveaway, Hosted by <@${giveaway.hostedBy}>.`;
			}

			await message.edit({ embeds: [newEmbed], components: [] }).catch(() => { });
			await message.reply({ content }).catch(() => { });

			console.log(`Successfully ended giveaway ${jobId}`);

		} finally {
			// Always cleanup job tracking and release lock
			await giveawaysManager.cleanupJob(client.redis, jobId, lockKey);
		}
	}

	// Helper method to cleanup job tracking and release lock
	private static async cleanupJob(redis: Redis, jobId: string, lockKey?: string) {
		// Remove from Redis active jobs
		await redis.hdel(ACTIVE_JOBS_KEY, jobId);

		// Release distributed lock if provided
		if (lockKey) {
			await redis.del(lockKey);
		}
	}

	// Check if a job is already active
	private static async isJobActive(redis: Redis, jobId: string): Promise<boolean> {
		const expiration = await redis.hget(ACTIVE_JOBS_KEY, jobId);
		if (!expiration) return false;

		const currentTime = Math.floor(Date.now() / 1000);
		const expirationTime = Number.parseInt(expiration);

		// If expired, clean it up
		if (currentTime > expirationTime) {
			await redis.hdel(ACTIVE_JOBS_KEY, jobId);
			return false;
		}

		return true;
	}

	static async join(interaction: ButtonInteraction, guildId: string, messageId: string, userId: string) {
		const giveaway = await Giveaway.get(guildId, messageId);
		if (!giveaway) {
			interaction.reply({ content: "Giveaway not found", flags: MessageFlags.Ephemeral });
			return;
		}
		if (giveaway.ended) {
			interaction.reply({ content: "This giveaway has already ended", flags: MessageFlags.Ephemeral });
			return;
		}
		if (giveaway.paused) {
			return interaction.reply({ content: "This giveaway is paused", flags: MessageFlags.Ephemeral });
		}
		const channel = await interaction.guild?.channels.fetch(giveaway.channelId);
		if (!channel || channel.type !== 0) return;
		const giveawayMessage = await channel.messages.fetch(messageId);
		if (!giveawayMessage) return;
		giveaway.participants ??= [];
		const giveawayEmbed = EmbedBuilder.from(giveawayMessage.embeds[0]!);
		const updatedGiveaway = await Giveaway.updateParticipants(guildId, messageId, userId);
		if (updatedGiveaway === false) {
			const yes = new ButtonBuilder().setCustomId("giveaway_leave").setLabel("Leave").setStyle(ButtonStyle.Danger);
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(yes);

			await interaction.reply({
				content: "You have already joined this giveaway\nAre you sure you want to lose your entry?",
				flags: MessageFlags.Ephemeral,
				components: [row],
			});
			const message = await interaction.fetchReply();
			const collector = message.createMessageComponentCollector({
				filter: (i) => i.user.id === userId,
				time: 15000,
			});

			collector.on("collect", async (i) => {
				console.log(i.customId);
				if (i.customId === "giveaway_leave") {
					giveaway.participants = giveaway.participants?.filter((user) => user.id !== userId);
					await Giveaway.update(guildId, messageId, giveaway);
					await i.update({
						content: "You have left the giveaway",
						components: [],
					});

					giveawayEmbed.setDescription(
						`Ends: <t:${Math.floor(giveaway.endAt.getTime() / 1000)}:R> (<t:${Math.floor(giveaway.endAt.getTime() / 1000)}>)\nHosted by: <@${giveaway.hostedBy}>\nEntries: \`${giveaway.participants?.length}\`\nWinners: \`${giveaway.winners}\``,
					);
					await giveawayMessage.edit({ embeds: [giveawayEmbed] }).catch(() => { });
					return collector.stop();
				}
			});
			return;
		}

		if (!updatedGiveaway) return;
		giveawayEmbed.setDescription(
			`Ends: <t:${Math.floor(giveaway.endAt.getTime() / 1000)}:R> (<t:${Math.floor(giveaway.endAt.getTime() / 1000)}>)\nHosted by: <@${updatedGiveaway.hostedBy}>\nEntries: \`${updatedGiveaway.participants?.length}\`\nWinners: \`${updatedGiveaway.winners}\``,
		);
		let msg: MessageEditOptions = { embeds: [giveawayEmbed] };
		if (updatedGiveaway?.participants?.length) {
			const button = new ButtonBuilder().setCustomId("giveaway_join").setEmoji("<:featured_seasonal_and_gifts_200d:1367474029556138045>").setStyle(ButtonStyle.Secondary);
			const view = new ButtonBuilder().setCustomId("giveaway_view").setEmoji("<:supervisor_account_200dp_E3E3E3_:1367483410364371014>").setStyle(ButtonStyle.Secondary);
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button, view);
			msg = { components: [row], embeds: [giveawayEmbed] };
		}

		await giveawayMessage.edit(msg).catch(() => { });
		return interaction.reply({ content: "You have joined the giveaway", flags: MessageFlags.Ephemeral });
	}

	static async delete(ctx: Context, guildId: string, messageId: string) {
		const giveaway = await Giveaway.get(guildId, messageId);
		if (!giveaway) return;

		// Clean up job tracking in Redis
		const jobId = `${guildId}-${messageId}`;
		await giveawaysManager.cleanupJob(ctx.client.redis, jobId);

		const channel = await ctx.guild?.channels.fetch(giveaway.channelId);
		if (!channel || channel.type !== 0) return;
		const giveawayMessage = await channel.messages.fetch(messageId);
		if (!giveawayMessage) return;
		await giveawayMessage.delete();

		await Giveaway.delete(guildId, messageId);
	}

	static async reroll(ctx: Context, guildId: string, messageId: string) {
		const giveaway = await Giveaway.get(guildId, messageId);
		if (!giveaway) return;
		if (!giveaway.ended) {
			return;
		}
		if (giveaway.paused) {
			return;
		}
		const channel = await ctx.guild?.channels.fetch(giveaway.channelId);
		if (!channel || channel.type !== 0) return;
		const giveawayMessage = await channel.messages.fetch(messageId);
		if (!giveawayMessage) return;
		if (!giveaway.participants?.length) return;
		// reroll the giveaway winner
		const newWinners = pickRandom(giveaway.participants, giveaway.winners);
		const content = `Congrats ${newWinners.map((u) => `<@${u.id}>`).join(", ")}! You won **${giveaway.prize}**, Hosted by <@${giveaway.hostedBy}>.`;

		await giveawayMessage.reply({ content }).catch(() => { });
	}

	static async scheduled(client: BaseClient) {
		const giveaways = await Giveaway.getAllUnended();
		if (!giveaways) return;

		const queue = createGiveawayQueue(client);

		for (const giveaway of giveaways) {
			const timeLeft = giveaway.endAt.getTime() - Date.now();
			const jobId = `${giveaway.guildId}-${giveaway.messageId}`;

			if (timeLeft <= 0) {
				// End immediately if time has passed
				await giveawaysManager.end(client, giveaway.guildId, giveaway.messageId);
			} else if (!(await giveawaysManager.isJobActive(client.redis, jobId))) {
				// Only add job if one doesn't already exist in Redis
				await queue.add(
					"endGiveaway",
					{
						guildId: giveaway.guildId,
						messageId: giveaway.messageId,
					},
					{
						delay: timeLeft,
						jobId: jobId, // Use unique job ID
					},
				);

				// Track the job in Redis with expiration
				const expirationTime = Math.floor((Date.now() + timeLeft) / 1000) + 300; // 5 minutes buffer
				await client.redis.hset(ACTIVE_JOBS_KEY, jobId, expirationTime);

				console.log(`Scheduled giveaway ${jobId} to end in ${timeLeft}ms`);
			} else {
				console.log(`Giveaway ${jobId} already has an active job, skipping`);
			}
		}
	}

	// Method to clean up expired jobs from Redis (call this periodically)
	static async cleanupExpiredJobs(redis: Redis) {
		const currentTime = Math.floor(Date.now() / 1000);
		const allJobs = await redis.hgetall(ACTIVE_JOBS_KEY);

		for (const [jobId, expiration] of Object.entries(allJobs)) {
			if (Number.parseInt(expiration) < currentTime) {
				await redis.hdel(ACTIVE_JOBS_KEY, jobId);
				console.log(`Cleaned up expired job: ${jobId}`);
			}
		}
	}

	// Method to get all active jobs (for debugging)
	static async getActiveJobs(redis: Redis) {
		return await redis.hgetall(ACTIVE_JOBS_KEY);
	}
}

function pickRandom<T>(arr: T[], count: number): T[] {
	const shuffled = [...arr].sort(() => 0.5 - Math.random());
	return shuffled.slice(0, count);
}