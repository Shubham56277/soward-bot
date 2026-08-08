/** Centralized BullMQ queue registry and workers. */
import { Queue, UnrecoverableError, Worker } from "bullmq"
import type { Redis } from "ioredis"
import { MessageFlags, type TextChannel } from "discord.js"
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
import { shutdownAutoRoleWorker } from "../modules/autorole/workers/autoRoleWorker"
import { shutdownAutoRoleQueue } from "../modules/autorole/queues/autoRoleQueue"
import { shutdownGiveawayWorker } from "../lib/giveaways/workers/giveawayWorker"
import { shutdownGiveawayQueue } from "../lib/giveaways/queue/giveawayQueue"

export let tempPunishmentQueue: Queue<TempPunishmentJob> | null = null
export let reminderQueue: Queue<ReminderJob> | null = null
export let moderationLogQueue: Queue<ModerationLogJob> | null = null
export let analyticsQueue: Queue<AnalyticsJob> | null = null
export let scheduledMessageQueue: Queue<ScheduledMessageJob> | null = null
export let aiChannelQueue: Queue<AiChannelRequestJob> | null = null

const workers: Worker[] = []
const queues: Queue[] = []
let lifecycleState: "idle" | "initializing" | "ready" | "shutting-down" = "idle"
let acceptingJobs = false
let shutdownRequested = false
let lifecycleTail: Promise<void> = Promise.resolve()

const MAX_JOB_BYTES = 16 * 1024
const MAX_ANALYTICS_INCREMENT = 1_000_000
const SNOWFLAKE_PATTERN = /^\d{1,20}$/
const SAFE_ALLOWED_MENTIONS = { parse: [] as const, repliedUser: false }

const DEFAULT_JOB_OPTIONS = {
	removeOnComplete: { count: 100 },
	removeOnFail: { count: 500 },
	attempts: 3,
	backoff: { type: "exponential" as const, delay: 2000 },
	sizeLimit: MAX_JOB_BYTES,
}

function serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
	const result = lifecycleTail.then(operation, operation)
	lifecycleTail = result.then(() => undefined, () => undefined)
	return result
}

export function initQueues(client: BaseClient): Promise<void> {
	shutdownRequested = false
	return serializeLifecycle(async () => {
		if (lifecycleState === "ready") {
			client.logger.warn("[queues] Initialization skipped because queues are already active")
			return
		}

		lifecycleState = "initializing"
		acceptingJobs = false
		const newQueues: Queue[] = []
		const newWorkers: Worker[] = []
		let discordQueueInitialized = false

		try {
			const temp = new Queue<TempPunishmentJob>("temp-punishment", {
				connection: client.redis,
				defaultJobOptions: DEFAULT_JOB_OPTIONS,
			})
			newQueues.push(temp)
			const reminder = new Queue<ReminderJob>("reminder", {
				connection: client.redis,
				defaultJobOptions: DEFAULT_JOB_OPTIONS,
			})
			newQueues.push(reminder)
			const moderationLog = new Queue<ModerationLogJob>("moderation-log", {
				connection: client.redis,
				defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
			})
			newQueues.push(moderationLog)
			const analytics = new Queue<AnalyticsJob>("analytics", {
				connection: client.redis,
				defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1, removeOnComplete: { count: 50 } },
			})
			newQueues.push(analytics)
			const scheduledMessage = new Queue<ScheduledMessageJob>("scheduled-message", {
				connection: client.redis,
				defaultJobOptions: DEFAULT_JOB_OPTIONS,
			})
			newQueues.push(scheduledMessage)
			const aiChannel = new Queue<AiChannelRequestJob>("ai-channel-request", {
				connection: client.redis,
				defaultJobOptions: {
					removeOnComplete: { count: 50 },
					removeOnFail: { count: 100 },
					attempts: 1,
					sizeLimit: MAX_JOB_BYTES,
				},
			})
			newQueues.push(aiChannel)

			newWorkers.push(registerWorker(createTempPunishmentWorker(client, client.redis), client, "temp-punishment"))
			newWorkers.push(registerWorker(createReminderWorker(client, client.redis), client, "reminder"))
			newWorkers.push(registerWorker(createModerationLogWorker(client, client.redis), client, "moderation-log"))
			newWorkers.push(registerWorker(createAnalyticsWorker(client, client.redis), client, "analytics"))
			newWorkers.push(registerWorker(createScheduledMessageWorker(client, client.redis), client, "scheduled-message"))
			newWorkers.push(registerWorker(createAiChannelWorker(client, client.redis), client, "ai-channel-request"))

			await initDiscordActionQueue(client)
			discordQueueInitialized = true

			if (!shutdownRequested) {
				tempPunishmentQueue = temp
				reminderQueue = reminder
				moderationLogQueue = moderationLog
				analyticsQueue = analytics
				scheduledMessageQueue = scheduledMessage
				aiChannelQueue = aiChannel
			}
			queues.push(...newQueues)
			workers.push(...newWorkers)
			lifecycleState = "ready"
			acceptingJobs = !shutdownRequested
			client.logger.success("[queues] All BullMQ queues and workers initialized")
		} catch (error) {
			acceptingJobs = false
			lifecycleState = "idle"
			workers.length = 0
			queues.length = 0
			clearExportedQueues()
			const rollbackResults = await Promise.allSettled([
				...newWorkers.map((worker) => worker.close()),
				...newQueues.map((queue) => queue.close()),
				...(discordQueueInitialized ? [shutdownDiscordActionQueue()] : []),
			])
			const failures = rejectedReasons(rollbackResults)
			if (failures.length > 0) {
				throw new AggregateError([error, ...failures], "Queue initialization and rollback failed")
			}
			throw error
		}
	})
}

export function shutdownQueues(): Promise<void> {
	shutdownRequested = true
	acceptingJobs = false
	clearExportedQueues()
	return serializeLifecycle(async () => {
		lifecycleState = "shutting-down"
		const resources = [...workers, ...queues]
		workers.length = 0
		queues.length = 0
		clearExportedQueues()

		const results = await Promise.allSettled([
			...resources.map((resource) => resource.close()),
			shutdownDiscordActionQueue(),
			shutdownAutoRoleWorker(),
			shutdownAutoRoleQueue(),
			shutdownGiveawayWorker(),
			shutdownGiveawayQueue(),
		])
		lifecycleState = "idle"
		const failures = rejectedReasons(results)
		if (failures.length > 0) throw new AggregateError(failures, "Failed to close one or more queue resources")
	})
}

function clearExportedQueues(): void {
	tempPunishmentQueue = null
	reminderQueue = null
	moderationLogQueue = null
	analyticsQueue = null
	scheduledMessageQueue = null
	aiChannelQueue = null
}

function registerWorker<T>(worker: Worker<T>, client: BaseClient, queueName: string): Worker<T> {
	worker.on("error", (error) => client.logger.error(`[queue:${queueName}] Worker error`, error))
	worker.on("failed", (job, error) => {
		client.logger.error(
			`[queue:${queueName}] Job ${job?.id ?? "unknown"} failed after ${job?.attemptsMade ?? 0} attempt(s)`,
			error,
		)
	})
	return worker
}

export async function enqueueAiChannelRequest(job: AiChannelRequestJob): Promise<void> {
	validateAiChannelJob(job)
	if (lifecycleState !== "ready" || !aiChannelQueue) {
		throw new Error(`AI channel queue is not initialized (state: ${lifecycleState})`)
	}
	if (!acceptingJobs) throw new Error("Queues are shutting down and are not accepting jobs")
	await aiChannelQueue.add("ai-reply", job)
}

function createTempPunishmentWorker(client: BaseClient, connection: Redis): Worker<TempPunishmentJob> {
	return new Worker<TempPunishmentJob>("temp-punishment", async (job) => {
		validateTempPunishmentJob(job.data)
		const { type, guildId, userId, reason } = job.data
		const guild = await client.guilds.fetch(guildId)
		if (type === "unban") {
			await guild.members.unban(userId, reason)
			client.logger.info(`[queue:temp-punishment] Unbanned ${userId} in ${guildId}`)
			return
		}
		const member = await guild.members.fetch(userId)
		await member.timeout(null, reason)
		client.logger.info(`[queue:temp-punishment] Unmuted ${userId} in ${guildId}`)
	}, workerOptions(connection, 5, 10, 10_000))
}

function createReminderWorker(client: BaseClient, connection: Redis): Worker<ReminderJob> {
	return new Worker<ReminderJob>("reminder", async (job) => {
		validateReminderJob(job.data)
		const { userId, channelId, guildId, message } = job.data
		const channel = await client.channels.fetch(channelId)
		if (!channel?.isTextBased()) permanentFailure(`Reminder channel ${channelId} is not text-based`)
		await (channel as TextChannel).send({
			content: `⏰ <@${userId}> Reminder: ${message}`,
			allowedMentions: { parse: [], users: [userId], repliedUser: false },
		})
		client.logger.info(`[queue:reminder] Delivered reminder to ${userId} in ${guildId}`)
	}, workerOptions(connection, 5, 10, 10_000))
}

function createModerationLogWorker(client: BaseClient, connection: Redis): Worker<ModerationLogJob> {
	return new Worker<ModerationLogJob>("moderation-log", async (job) => {
		validateModerationLogJob(job.data)
		const { guildId, action, targetId, moderatorId, reason } = job.data
		await client.guilds.fetch(guildId)
		const logChannelId = await client.redis.get(`guild:${guildId}:modlog_channel`)
		if (!logChannelId) return
		requireSnowflake(logChannelId, "configured moderation log channel")
		const channel = await client.channels.fetch(logChannelId)
		if (!channel?.isTextBased()) permanentFailure(`Moderation log channel ${logChannelId} is not text-based`)
		await (channel as TextChannel).send({
			embeds: [{
				title: `Moderation Action: ${action}`,
				fields: [
					{ name: "Target", value: `<@${targetId}>`, inline: true },
					{ name: "Moderator", value: `<@${moderatorId}>`, inline: true },
					{ name: "Reason", value: reason || "No reason provided", inline: false },
				],
				color: 0xff6b6b,
				timestamp: new Date().toISOString(),
			}],
			allowedMentions: SAFE_ALLOWED_MENTIONS,
		})
		client.logger.info(`[queue:moderation-log] Logged ${action} for ${targetId} in ${guildId}`)
	}, workerOptions(connection, 5, 10, 10_000))
}

function createAnalyticsWorker(client: BaseClient, connection: Redis): Worker<AnalyticsJob> {
	return new Worker<AnalyticsJob>("analytics", async (job) => {
		validateAnalyticsJob(job.data)
		const { type, guildId, data } = job.data
		const now = new Date()
		const dateKey = `${now.getFullYear()}:${String(now.getMonth() + 1).padStart(2, "0")}:${String(now.getDate()).padStart(2, "0")}`
		const baseKey = `analytics:${guildId}:${dateKey}`
		await client.redis.hincrby(baseKey, type, 1)
		if (data.count !== undefined) {
			await client.redis.hincrby(`${baseKey}:totals`, type, data.count as number)
		}
		const ttl = 90 * 24 * 60 * 60
		await Promise.all([
			client.redis.expire(baseKey, ttl),
			client.redis.expire(`${baseKey}:totals`, ttl),
		])
	}, workerOptions(connection, 10, 10, 10_000))
}

function createScheduledMessageWorker(client: BaseClient, connection: Redis): Worker<ScheduledMessageJob> {
	return new Worker<ScheduledMessageJob>("scheduled-message", async (job) => {
		validateScheduledMessageJob(job.data)
		const { guildId, channelId, content } = job.data
		const channel = await client.channels.fetch(channelId)
		if (!channel?.isTextBased()) permanentFailure(`Scheduled message channel ${channelId} is not text-based`)
		await (channel as TextChannel).send({ content, allowedMentions: SAFE_ALLOWED_MENTIONS })
		client.logger.info(`[queue:scheduled-message] Sent scheduled message to ${channelId} in ${guildId}`)
	}, workerOptions(connection, 5, 10, 10_000))
}

function createAiChannelWorker(client: BaseClient, connection: Redis): Worker<AiChannelRequestJob> {
	return new Worker<AiChannelRequestJob>("ai-channel-request", async (job) => {
		validateAiChannelJob(job.data)
		const { guildId, channelId, userId, messageId, question } = job.data
		const channel = await client.channels.fetch(channelId)
		if (!channel?.isTextBased()) permanentFailure(`AI channel ${channelId} is not text-based`)
		if (!await client.ai.isChannelSessionActive(guildId, channelId)) return

		const scope = { guildId, channelId, userId }
		let answerText: string | null = null
		let lastFailure: unknown = null
		for (let attempt = 0; attempt < 3 && !answerText; attempt++) {
			try {
				const ragResult = await client.rag.ask({ scope, question, useHistory: true, skipRateLimit: true })
				if (ragResult.ok) answerText = ragResult.answer.text
				else lastFailure = new Error("RAG service returned an unsuccessful response")
			} catch (error) {
				lastFailure = error
			}

			if (!answerText) {
				try {
					const aiResult = await client.ai.ask(scope, question, true)
					if (aiResult.ok) answerText = aiResult.answer.text
					else lastFailure = new Error("AI service returned an unsuccessful response")
				} catch (error) {
					lastFailure = error
				}
			}
			if (!answerText && attempt < 2) await delay(2000)
		}
		if (!answerText) {
			throw new Error(`AI services failed to produce a response: ${errorMessage(lastFailure)}`)
		}

		const textChannel = channel as TextChannel
		const originalMessage = await textChannel.messages.fetch(messageId).catch(() => null)
		const { splitDiscordMessage } = await import("../service/aiService.js")
		const chunks = splitDiscordMessage(answerText)
		if (chunks.length === 0) permanentFailure("AI response was empty")

		for (const chunk of chunks) {
			if (originalMessage) {
				await originalMessage.reply({
					content: chunk,
					allowedMentions: SAFE_ALLOWED_MENTIONS,
					flags: MessageFlags.SuppressNotifications,
				})
			} else {
				await textChannel.send({ content: chunk, allowedMentions: SAFE_ALLOWED_MENTIONS })
			}
		}
	}, workerOptions(connection, 5, 5, 5000))
}

function workerOptions(connection: Redis, concurrency: number, max: number, duration: number) {
	return { connection, concurrency, limiter: { max, duration } }
}

function validateTempPunishmentJob(job: TempPunishmentJob): void {
	assertObject(job, "temp punishment job")
	if (job.type !== "unban" && job.type !== "unmute") permanentFailure("Invalid temporary punishment type")
	requireSnowflake(job.guildId, "guildId")
	requireSnowflake(job.userId, "userId")
	requireText(job.reason, "reason", 512)
	validateSerializedSize(job)
}

function validateReminderJob(job: ReminderJob): void {
	assertObject(job, "reminder job")
	requireSnowflake(job.userId, "userId")
	requireSnowflake(job.channelId, "channelId")
	requireSnowflake(job.guildId, "guildId")
	requireText(job.message, "message", 1800)
	validateSerializedSize(job)
}

function validateModerationLogJob(job: ModerationLogJob): void {
	assertObject(job, "moderation log job")
	requireSnowflake(job.guildId, "guildId")
	requireSnowflake(job.targetId, "targetId")
	requireSnowflake(job.moderatorId, "moderatorId")
	requireText(job.action, "action", 100)
	requireText(job.reason, "reason", 1024, true)
	validateSerializedSize(job)
}

function validateAnalyticsJob(job: AnalyticsJob): void {
	assertObject(job, "analytics job")
	requireSnowflake(job.guildId, "guildId")
	requireText(job.type, "type", 100)
	assertObject(job.data, "analytics data")
	if (job.data.count !== undefined && (
		typeof job.data.count !== "number"
		|| !Number.isSafeInteger(job.data.count)
		|| Math.abs(job.data.count) > MAX_ANALYTICS_INCREMENT
	)) {
		permanentFailure(`analytics count must be a safe integer between -${MAX_ANALYTICS_INCREMENT} and ${MAX_ANALYTICS_INCREMENT}`)
	}
	validateSerializedSize(job)
}

function validateScheduledMessageJob(job: ScheduledMessageJob): void {
	assertObject(job, "scheduled message job")
	requireSnowflake(job.guildId, "guildId")
	requireSnowflake(job.channelId, "channelId")
	requireText(job.content, "content", 2000)
	validateSerializedSize(job)
}

function validateAiChannelJob(job: AiChannelRequestJob): void {
	assertObject(job, "AI channel job")
	requireSnowflake(job.guildId, "guildId")
	requireSnowflake(job.channelId, "channelId")
	requireSnowflake(job.userId, "userId")
	requireSnowflake(job.messageId, "messageId")
	requireText(job.question, "question", 8000)
	validateSerializedSize(job)
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) permanentFailure(`${name} must be an object`)
}

function requireSnowflake(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !SNOWFLAKE_PATTERN.test(value)) permanentFailure(`${field} must be a Discord snowflake`)
}

function requireText(value: unknown, field: string, maxLength: number, allowEmpty = false): asserts value is string {
	if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) {
		permanentFailure(`${field} must contain ${allowEmpty ? "0" : "1"} to ${maxLength} characters`)
	}
}

function validateSerializedSize(value: unknown): void {
	let encoded: string
	try {
		encoded = JSON.stringify(value)
	} catch {
		permanentFailure("Job payload must be JSON serializable")
	}
	if (Buffer.byteLength(encoded!, "utf8") > MAX_JOB_BYTES) permanentFailure(`Job payload exceeds ${MAX_JOB_BYTES} bytes`)
}

function permanentFailure(message: string): never {
	throw new UnrecoverableError(message)
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]): unknown[] {
	return results
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason)
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "unknown error")
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
