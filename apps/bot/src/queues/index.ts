/**
 * Centralized Queue Registry
 *
 * All BullMQ queues and workers are registered here.
 * Call `initQueues(client)` during bot startup to initialize everything.
 * Call `shutdownQueues()` during graceful shutdown to close all workers.
 *
 * Existing queues (autorole, giveaway) are NOT managed here — they
 * continue to work independently as before.
 */
import { Queue, Worker } from "bullmq"
import type { Redis } from "ioredis"
import type { TextChannel } from "discord.js"
import type BaseClient from "../base/Client"
import type {
	TempPunishmentJob,
	ReminderJob,
	ModerationLogJob,
	AnalyticsJob,
	ScheduledMessageJob,
	AiChannelRequestJob,
} from "./types"
import { initDiscordActionQueue, shutdownDiscordActionQueue } from "./discordActionQueue"

// ─────────────────────────────────────────────────────────
// Queue Instances (available after initQueues)
// ─────────────────────────────────────────────────────────

export let tempPunishmentQueue: Queue<TempPunishmentJob>
export let reminderQueue: Queue<ReminderJob>
export let moderationLogQueue: Queue<ModerationLogJob>
export let analyticsQueue: Queue<AnalyticsJob>
export let scheduledMessageQueue: Queue<ScheduledMessageJob>
export let aiChannelQueue: Queue<AiChannelRequestJob>

// ─────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────

const workers: Worker[] = []

const DEFAULT_JOB_OPTIONS = {
	removeOnComplete: { count: 100 },
	removeOnFail: { count: 500 },
	attempts: 3,
	backoff: { type: "exponential" as const, delay: 2000 },
}

// ─────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────

export async function initQueues(client: BaseClient): Promise<void> {
	const connection = client.redis

	// Create queues
	tempPunishmentQueue = new Queue<TempPunishmentJob>("temp-punishment", {
		connection,
		defaultJobOptions: DEFAULT_JOB_OPTIONS,
	})

	reminderQueue = new Queue<ReminderJob>("reminder", {
		connection,
		defaultJobOptions: DEFAULT_JOB_OPTIONS,
	})

	moderationLogQueue = new Queue<ModerationLogJob>("moderation-log", {
		connection,
		defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
	})

	analyticsQueue = new Queue<AnalyticsJob>("analytics", {
		connection,
		defaultJobOptions: {
			...DEFAULT_JOB_OPTIONS,
			attempts: 1,
			removeOnComplete: { count: 50 },
		},
	})

	scheduledMessageQueue = new Queue<ScheduledMessageJob>("scheduled-message", {
		connection,
		defaultJobOptions: DEFAULT_JOB_OPTIONS,
	})

	aiChannelQueue = new Queue<AiChannelRequestJob>("ai-channel-request", {
		connection,
		defaultJobOptions: {
			removeOnComplete: { count: 50 },
			removeOnFail: { count: 100 },
			attempts: 1,
		},
	})

	// Create workers
	workers.push(createTempPunishmentWorker(client, connection))
	workers.push(createReminderWorker(client, connection))
	workers.push(createModerationLogWorker(client, connection))
	workers.push(createAnalyticsWorker(client, connection))
	workers.push(createScheduledMessageWorker(client, connection))
	workers.push(createAiChannelWorker(client, connection))

	// Discord API action queue (rate-limit safe bulk operations)
	initDiscordActionQueue(client)

	client.logger.success("[queues] All BullMQ queues and workers initialized")
}

// ─────────────────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────────────────

export async function shutdownQueues(): Promise<void> {
	await Promise.allSettled(workers.map((w) => w.close()))
	await shutdownDiscordActionQueue()
}

// ─────────────────────────────────────────────────────────
// Worker Factories
// ─────────────────────────────────────────────────────────

function createTempPunishmentWorker(client: BaseClient, connection: Redis): Worker<TempPunishmentJob> {
	return new Worker<TempPunishmentJob>(
		"temp-punishment",
		async (job) => {
			const { type, guildId, userId, reason } = job.data

			try {
				const guild = await client.guilds.fetch(guildId).catch(() => null)
				if (!guild) {
					client.logger.warn(`[queue:temp-punishment] Guild ${guildId} not found`)
					return
				}

				if (type === "unban") {
					await guild.members.unban(userId, reason).catch((err) => {
						client.logger.warn(`[queue:temp-punishment] Failed to unban ${userId} in ${guildId}: ${err.message}`)
					})
					client.logger.info(`[queue:temp-punishment] Unbanned ${userId} in ${guildId}`)
				} else if (type === "unmute") {
					const member = await guild.members.fetch(userId).catch(() => null)
					if (!member) {
						client.logger.warn(`[queue:temp-punishment] Member ${userId} not found in ${guildId}`)
						return
					}
					await member.timeout(null, reason).catch((err) => {
						client.logger.warn(`[queue:temp-punishment] Failed to unmute ${userId} in ${guildId}: ${err.message}`)
					})
					client.logger.info(`[queue:temp-punishment] Unmuted ${userId} in ${guildId}`)
				}
			} catch (err) {
				client.logger.error(`[queue:temp-punishment] Unexpected error: ${err}`)
				throw err
			}
		},
		{
			connection,
			concurrency: 5,
			limiter: {
				max: 10,
				duration: 10000,
			},
		},
	)
}

function createReminderWorker(client: BaseClient, connection: Redis): Worker<ReminderJob> {
	return new Worker<ReminderJob>(
		"reminder",
		async (job) => {
			const { userId, channelId, guildId, message } = job.data

			try {
				const channel = await client.channels.fetch(channelId).catch(() => null)
				if (!channel || !channel.isTextBased()) {
					client.logger.warn(`[queue:reminder] Channel ${channelId} not found or not text-based`)
					return
				}

				await (channel as TextChannel).send({
					content: `⏰ <@${userId}> Reminder: ${message}`,
				})

				client.logger.info(`[queue:reminder] Delivered reminder to ${userId} in ${guildId}`)
			} catch (err) {
				client.logger.error(`[queue:reminder] Unexpected error: ${err}`)
				throw err
			}
		},
		{
			connection,
			concurrency: 5,
			limiter: {
				max: 10,
				duration: 10000,
			},
		},
	)
}

function createModerationLogWorker(client: BaseClient, connection: Redis): Worker<ModerationLogJob> {
	return new Worker<ModerationLogJob>(
		"moderation-log",
		async (job) => {
			const { guildId, action, targetId, moderatorId, reason } = job.data

			try {
				const guild = await client.guilds.fetch(guildId).catch(() => null)
				if (!guild) {
					client.logger.warn(`[queue:moderation-log] Guild ${guildId} not found`)
					return
				}

				// Attempt to find a configured moderation log channel
				const logChannelId = await client.redis.get(`guild:${guildId}:modlog_channel`)
				if (!logChannelId) {
					return // No moderation log channel configured, skip silently
				}

				const logChannel = await client.channels.fetch(logChannelId).catch(() => null)
				if (!logChannel || !logChannel.isTextBased()) {
					return
				}

				await (logChannel as TextChannel).send({
					embeds: [
						{
							title: `Moderation Action: ${action}`,
							fields: [
								{ name: "Target", value: `<@${targetId}>`, inline: true },
								{ name: "Moderator", value: `<@${moderatorId}>`, inline: true },
								{ name: "Reason", value: reason || "No reason provided", inline: false },
							],
							color: 0xff6b6b,
							timestamp: new Date().toISOString(),
						},
					],
				})

				client.logger.info(`[queue:moderation-log] Logged ${action} for ${targetId} in ${guildId}`)
			} catch (err) {
				client.logger.error(`[queue:moderation-log] Unexpected error: ${err}`)
				throw err
			}
		},
		{
			connection,
			concurrency: 5,
			limiter: {
				max: 10,
				duration: 10000,
			},
		},
	)
}

function createAnalyticsWorker(client: BaseClient, connection: Redis): Worker<AnalyticsJob> {
	return new Worker<AnalyticsJob>(
		"analytics",
		async (job) => {
			const { type, guildId, data } = job.data

			try {
				const now = new Date()
				const dateKey = `${now.getFullYear()}:${String(now.getMonth() + 1).padStart(2, "0")}:${String(now.getDate()).padStart(2, "0")}`

				// Increment general analytics counter
				await client.redis.hincrby(`analytics:${guildId}:${dateKey}`, type, 1)

				// If data contains a count field, use it for the increment
				if (typeof data.count === "number") {
					await client.redis.hincrby(`analytics:${guildId}:${dateKey}:totals`, type, data.count)
				}

				// Set TTL to 90 days for automatic cleanup
				const ttl = 90 * 24 * 60 * 60
				await client.redis.expire(`analytics:${guildId}:${dateKey}`, ttl)
				await client.redis.expire(`analytics:${guildId}:${dateKey}:totals`, ttl)
			} catch (err) {
				client.logger.error(`[queue:analytics] Unexpected error: ${err}`)
				throw err
			}
		},
		{
			connection,
			concurrency: 10,
			limiter: {
				max: 10,
				duration: 10000,
			},
		},
	)
}

function createScheduledMessageWorker(client: BaseClient, connection: Redis): Worker<ScheduledMessageJob> {
	return new Worker<ScheduledMessageJob>(
		"scheduled-message",
		async (job) => {
			const { guildId, channelId, content } = job.data

			try {
				const channel = await client.channels.fetch(channelId).catch(() => null)
				if (!channel || !channel.isTextBased()) {
					client.logger.warn(`[queue:scheduled-message] Channel ${channelId} not found or not text-based`)
					return
				}

				await (channel as TextChannel).send({ content })
				client.logger.info(`[queue:scheduled-message] Sent scheduled message to ${channelId} in ${guildId}`)
			} catch (err) {
				client.logger.error(`[queue:scheduled-message] Unexpected error: ${err}`)
				throw err
			}
		},
		{
			connection,
			concurrency: 5,
			limiter: {
				max: 10,
				duration: 10000,
			},
		},
	)
}

function createAiChannelWorker(client: BaseClient, connection: Redis): Worker<AiChannelRequestJob> {
	return new Worker<AiChannelRequestJob>(
		"ai-channel-request",
		async (job) => {
			const { guildId, channelId, userId, messageId, question } = job.data
			try {
				const channel = await client.channels.fetch(channelId).catch(() => null)
				if (!channel || !channel.isTextBased()) return

				// Check if channel session is still active
				const active = await client.ai.isChannelSessionActive(guildId, channelId)
				if (!active) return

				const scope = { guildId, channelId, userId }

				// Try up to 3 times with a 2s delay between attempts
				let result: any = null
				for (let attempt = 0; attempt < 3; attempt++) {
					result = await client.rag.ask({ scope, question, useHistory: true, skipRateLimit: true })
					if (result.ok) break
					// Wait 2s before retry
					if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
				}

				if (!result?.ok) return // Silently give up after 3 attempts

				// Fetch the original message to reply to it
				const originalMessage = await (channel as any).messages.fetch(messageId).catch(() => null)
				if (originalMessage) {
					const { splitDiscordMessage } = await import("../service/aiService")
					const chunks = splitDiscordMessage(result.answer.text)
					for (const chunk of chunks) {
						await originalMessage.reply({
							content: chunk,
							allowedMentions: { parse: [], repliedUser: false },
							flags: 4096, // SuppressNotifications
						}).catch(() => {})
					}
				} else {
					// Message was deleted, send in channel
					const { splitDiscordMessage } = await import("../service/aiService")
					const chunks = splitDiscordMessage(result.answer.text)
					for (const chunk of chunks) {
						await (channel as any).send({
							content: chunk,
							allowedMentions: { parse: [] },
						}).catch(() => {})
					}
				}
			} catch (err) {
				client.logger.error(`[queue:ai-channel] Error: ${err}`)
			}
		},
		{
			connection,
			concurrency: 2,
			limiter: {
				max: 2,
				duration: 3000,
			},
		},
	)
}
