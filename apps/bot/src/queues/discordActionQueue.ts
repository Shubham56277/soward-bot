/**
 * Rate-limited BullMQ queue for Discord API operations.
 * Enqueue deduplication is handled atomically by BullMQ/Redis.
 */
import { Queue, UnrecoverableError, Worker, type JobsOptions } from "bullmq";
import type {
	GuildChannelCreateOptions,
	GuildChannelEditOptions,
	GuildTextBasedChannel,
	Guild,
	RoleCreateOptions,
	RoleEditOptions,
} from "discord.js";
import type BaseClient from "../base/Client";

export type DiscordActionType =
	| "deleteMessage"
	| "bulkDeleteMessages"
	| "banMember"
	| "kickMember"
	| "removeRoles"
	| "setRoles"
	| "deleteChannel"
	| "createChannel"
	| "deleteRole"
	| "createRole"
	| "timeoutMember"
	| "editChannel"
	| "editRole";

export type DiscordActionPayload =
	| GuildChannelCreateOptions
	| GuildChannelEditOptions
	| RoleCreateOptions
	| RoleEditOptions;

export interface DiscordActionJob {
	type: DiscordActionType;
	guildId: string;
	channelId?: string;
	messageId?: string;
	messageIds?: string[];
	targetId?: string;
	roleIds?: string[];
	reason?: string;
	duration?: number;
	priority?: number;
	/** BullMQ deduplication identifier. */
	dedupeKey?: string;
	payload?: DiscordActionPayload;
}

export const PRIORITY = {
	CRITICAL: 1,
	HIGH: 2,
	NORMAL: 5,
	LOW: 7,
	BACKGROUND: 10,
} as const;

const QUEUE_NAME = "discord-actions";
const DEDUPE_TTL_MS = 30_000;
const GUILD_DRAIN_BLOCK_MS = 60_000;
const MAX_REASON_LENGTH = 512;
const MAX_DEDUPE_KEY_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_ROLE_IDS = 250;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const MAX_BULLMQ_PRIORITY = 2_097_151;
const SNOWFLAKE_PATTERN = /^\d{1,20}$/;

const CHANNEL_PAYLOAD_KEYS = new Set([
	"name", "type", "position", "topic", "nsfw", "bitrate", "userLimit", "parent",
	"rateLimitPerUser", "lockPermissions", "permissionOverwrites", "defaultAutoArchiveDuration",
	"rtcRegion", "videoQualityMode", "availableTags", "defaultReactionEmoji",
	"defaultThreadRateLimitPerUser", "flags", "defaultSortOrder", "defaultForumLayout",
]);
const ROLE_PAYLOAD_KEYS = new Set([
	"name", "color", "colors", "hoist", "icon", "unicodeEmoji", "position", "permissions", "mentionable",
]);

let discordActionQueue: Queue<DiscordActionJob> | null = null;
let discordActionWorker: Worker<DiscordActionJob> | null = null;
let lifecycleState: "idle" | "initializing" | "ready" | "shutting-down" = "idle";
let acceptingActions = false;
let shutdownRequested = false;
let lifecycleTail: Promise<void> = Promise.resolve();
const blockedGuilds = new Map<string, number>();

function serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
	const result = lifecycleTail.then(operation, operation);
	lifecycleTail = result.then(() => undefined, () => undefined);
	return result;
}

export function initDiscordActionQueue(client: BaseClient): Promise<void> {
	shutdownRequested = false;
	return serializeLifecycle(async () => {
		if (lifecycleState === "ready") {
			client.logger.warn("[queues] Discord action queue initialization skipped because it is already active");
			return;
		}

		lifecycleState = "initializing";
		acceptingActions = false;
		let queue: Queue<DiscordActionJob> | null = null;
		let worker: Worker<DiscordActionJob> | null = null;

		try {
			queue = new Queue<DiscordActionJob>(QUEUE_NAME, {
				connection: client.redis,
				defaultJobOptions: {
					removeOnComplete: { count: 1000 },
					removeOnFail: { count: 500 },
					attempts: 4,
					backoff: { type: "exponential", delay: 2500 },
					sizeLimit: MAX_PAYLOAD_BYTES,
				},
			});

			worker = createWorker(client);
			discordActionQueue = queue;
			discordActionWorker = worker;
			lifecycleState = "ready";
			acceptingActions = !shutdownRequested;
			client.logger.success("[queues] Discord action queue initialized (concurrency: 5, rate: 10/5s)");
		} catch (error) {
			acceptingActions = false;
			lifecycleState = "idle";
			discordActionQueue = null;
			discordActionWorker = null;
			const rollback = await Promise.allSettled([
				worker?.close(),
				queue?.close(),
			].filter((value): value is Promise<void> => Boolean(value)));
			const rollbackFailures = rejectedReasons(rollback);
			if (rollbackFailures.length > 0) {
				throw new AggregateError([error, ...rollbackFailures], "Discord action queue initialization and rollback failed");
			}
			throw error;
		}
	});
}

function createWorker(client: BaseClient): Worker<DiscordActionJob> {
	const worker = new Worker<DiscordActionJob>(
		QUEUE_NAME,
		async (job) => {
			try {
				validateJob(job.data);
				await executeAction(client, job.data);
			} catch (error) {
				if (error instanceof UnrecoverableError) throw error;
				if (isPermanentDiscordError(error)) {
					throw new UnrecoverableError(`Permanent Discord API failure: ${errorMessage(error)}`);
				}
				throw error;
			}
		},
		{
			connection: client.redis,
			concurrency: 5,
			limiter: { max: 10, duration: 5000 },
		},
	);

	worker.on("error", (error) => {
		client.logger.error("[discord-action-queue] Worker error", error);
	});
	worker.on("failed", (job, error) => {
		client.logger.error(
			`[discord-action-queue] Job ${job?.id ?? "unknown"} failed after ${job?.attemptsMade ?? 0} attempt(s): ${job?.data.type ?? "unknown"}`,
			error,
		);
	});
	return worker;
}

async function executeAction(client: BaseClient, data: DiscordActionJob): Promise<void> {
	const guild = client.guilds.cache.get(data.guildId) ?? await client.guilds.fetch(data.guildId);
	const reason = data.reason ?? defaultReason(data.type);

	switch (data.type) {
		case "deleteMessage": {
			const channel = await fetchGuildChannel(guild, data.channelId!);
			if (!("messages" in channel)) permanentFailure("Channel does not support messages");
			await (channel as GuildTextBasedChannel).messages.delete(data.messageId!);
			return;
		}
		case "bulkDeleteMessages": {
			const channel = await fetchGuildChannel(guild, data.channelId!);
			if (!("bulkDelete" in channel)) permanentFailure("Channel does not support bulk deletion");
			await channel.bulkDelete(data.messageIds!, true);
			return;
		}
		case "banMember":
			await guild.members.ban(data.targetId!, { reason, deleteMessageSeconds: 604800 });
			return;
		case "kickMember": {
			const member = guild.members.cache.get(data.targetId!) ?? await guild.members.fetch(data.targetId!);
			if (!member.kickable) permanentFailure("Member is not kickable");
			await member.kick(reason);
			return;
		}
		case "removeRoles": {
			const member = guild.members.cache.get(data.targetId!) ?? await guild.members.fetch(data.targetId!);
			if (!member.manageable) permanentFailure("Member roles are not manageable");
			await member.roles.remove(data.roleIds!, reason);
			return;
		}
		case "setRoles": {
			const member = guild.members.cache.get(data.targetId!) ?? await guild.members.fetch(data.targetId!);
			if (!member.manageable) permanentFailure("Member roles are not manageable");
			await member.roles.set(data.roleIds!, reason);
			return;
		}
		case "deleteChannel": {
			const channel = await fetchGuildChannel(guild, data.channelId!);
			await channel.delete(reason);
			return;
		}
		case "createChannel":
			await guild.channels.create({ ...(data.payload as GuildChannelCreateOptions), reason });
			return;
		case "deleteRole": {
			const role = guild.roles.cache.get(data.targetId!) ?? await guild.roles.fetch(data.targetId!);
			if (!role || !role.editable) permanentFailure("Role is missing or not editable");
			await role.delete(reason);
			return;
		}
		case "createRole":
			await guild.roles.create({ ...(data.payload as RoleCreateOptions), reason });
			return;
		case "timeoutMember": {
			const member = guild.members.cache.get(data.targetId!) ?? await guild.members.fetch(data.targetId!);
			if (!member.moderatable) permanentFailure("Member is not moderatable");
			await member.timeout(data.duration ?? 3_600_000, reason);
			return;
		}
		case "editChannel": {
			const channel = await fetchGuildChannel(guild, data.channelId!);
			if (!channel.manageable) permanentFailure("Channel is not manageable");
			await channel.edit({ ...(data.payload as GuildChannelEditOptions), reason });
			return;
		}
		case "editRole": {
			const role = guild.roles.cache.get(data.targetId!) ?? await guild.roles.fetch(data.targetId!);
			if (!role || !role.editable) permanentFailure("Role is missing or not editable");
			await role.edit({ ...(data.payload as RoleEditOptions), reason });
			return;
		}
	}
}

async function fetchGuildChannel(
	guild: Guild,
	channelId: string,
) {
	const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId);
	if (!channel) permanentFailure(`Channel ${channelId} was not found`);
	return channel;
}

export async function queueDiscordAction(job: DiscordActionJob): Promise<void> {
	validateJob(job);
	const queue = requireReadyQueue();
	assertGuildAccepting(job.guildId);
	await queue.add("action", job, jobOptions(job));
}

export async function queueBulkMessageDelete(
	guildId: string,
	channelId: string,
	messageIds: string[],
	reason?: string,
): Promise<void> {
	requireId(guildId, "guildId");
	requireId(channelId, "channelId");
	assertNonEmptyIds(messageIds, "messageIds", 10_000);
	const queue = requireReadyQueue();
	assertGuildAccepting(guildId);
	const chunks = chunkArray([...new Set(messageIds)], 100);
	const jobs = chunks.map((chunk) => {
		const data: DiscordActionJob = {
			type: "bulkDeleteMessages",
			guildId,
			channelId,
			messageIds: chunk,
			reason: reason ?? "[AUTOMOD] Spam cleanup",
			priority: PRIORITY.LOW,
			dedupeKey: `bulkdel:${guildId}:${channelId}:${chunk[0]}:${chunk.at(-1)}:${chunk.length}`,
		};
		validateJob(data);
		return { name: "action", data, opts: jobOptions(data) };
	});
	await queue.addBulk(jobs);
}

export async function queueBulkChannelDelete(
	guildId: string,
	channelIds: string[],
	reason?: string,
): Promise<void> {
	requireId(guildId, "guildId");
	assertNonEmptyIds(channelIds, "channelIds", 10_000);
	const queue = requireReadyQueue();
	assertGuildAccepting(guildId);
	const jobs = [...new Set(channelIds)].map((channelId) => {
		const data: DiscordActionJob = {
			type: "deleteChannel",
			guildId,
			channelId,
			reason: reason ?? "[ANTINUKE] Cleanup unauthorized channels",
			priority: PRIORITY.NORMAL,
			dedupeKey: `delch:${guildId}:${channelId}`,
		};
		validateJob(data);
		return { name: "action", data, opts: jobOptions(data) };
	});
	await queue.addBulk(jobs);
}

export async function queuePunishment(
	guildId: string,
	targetId: string,
	type: "banMember" | "kickMember" | "timeoutMember",
	reason: string,
	duration?: number,
): Promise<void> {
	await queueDiscordAction({
		type,
		guildId,
		targetId,
		reason,
		duration,
		priority: PRIORITY.CRITICAL,
		dedupeKey: `punish:${guildId}:${targetId}:${type}`,
	});
}

export async function queueRoleStrip(
	guildId: string,
	targetId: string,
	roleIds: string[],
	reason?: string,
): Promise<void> {
	if (roleIds.length === 0) return;
	await queueDiscordAction({
		type: "removeRoles",
		guildId,
		targetId,
		roleIds: [...new Set(roleIds)],
		reason: reason ?? "[ANTINUKE] Role strip",
		priority: PRIORITY.HIGH,
		dedupeKey: `rolestrip:${guildId}:${targetId}`,
	});
}

export async function getQueueStats(): Promise<{ waiting: number; active: number; delayed: number; failed: number }> {
	const queue = requireReadyQueue(false);
	const [waiting, active, delayed, failed] = await Promise.all([
		queue.getWaitingCount(),
		queue.getActiveCount(),
		queue.getDelayedCount(),
		queue.getFailedCount(),
	]);
	return { waiting, active, delayed, failed };
}

/** Remove pending jobs for a guild and reject new jobs for it for 60 seconds. */
export async function drainGuildJobs(guildId: string): Promise<number> {
	requireId(guildId, "guildId");
	const queue = requireReadyQueue(false);
	blockedGuilds.set(guildId, Date.now() + GUILD_DRAIN_BLOCK_MS);
	let removed = 0;
	const jobs = await queue.getJobs(["wait", "delayed", "prioritized", "paused"], 0, -1, true);
	for (const job of jobs) {
		if (job.data.guildId !== guildId) continue;
		try {
			await job.remove();
			removed++;
		} catch (error) {
			const state = await job.getState();
			if (["waiting", "delayed", "prioritized"].includes(state)) throw error;
		}
	}
	return removed;
}

export function shutdownDiscordActionQueue(): Promise<void> {
	shutdownRequested = true;
	acceptingActions = false;
	return serializeLifecycle(async () => {
		if (lifecycleState === "idle") {
			blockedGuilds.clear();
			return;
		}

		lifecycleState = "shutting-down";
		const worker = discordActionWorker;
		const queue = discordActionQueue;
		discordActionWorker = null;
		discordActionQueue = null;
		blockedGuilds.clear();

		const results = await Promise.allSettled([
			worker?.close(),
			queue?.close(),
		].filter((value): value is Promise<void> => Boolean(value)));
		lifecycleState = "idle";
		const failures = rejectedReasons(results);
		if (failures.length > 0) {
			throw new AggregateError(failures, "Failed to close Discord action queue resources");
		}
	});
}

function requireReadyQueue(requireAccepting = true): Queue<DiscordActionJob> {
	if (lifecycleState !== "ready" || !discordActionQueue) {
		throw new Error(`Discord action queue is not initialized (state: ${lifecycleState})`);
	}
	if (requireAccepting && !acceptingActions) {
		throw new Error("Discord action queue is shutting down and is not accepting jobs");
	}
	return discordActionQueue;
}

function assertGuildAccepting(guildId: string): void {
	const blockedUntil = blockedGuilds.get(guildId);
	if (blockedUntil === undefined) return;
	if (blockedUntil <= Date.now()) {
		blockedGuilds.delete(guildId);
		return;
	}
	throw new Error(`Discord actions for guild ${guildId} are temporarily blocked while pending jobs are drained`);
}

function jobOptions(job: DiscordActionJob): JobsOptions {
	return {
		priority: job.priority ?? PRIORITY.NORMAL,
		...(job.dedupeKey ? { deduplication: { id: job.dedupeKey, ttl: DEDUPE_TTL_MS } } : {}),
	};
}

function validateJob(job: DiscordActionJob): void {
	if (!job || typeof job !== "object") permanentFailure("Job payload must be an object");
	if (!isActionType(job.type)) permanentFailure(`Unsupported Discord action type: ${String(job.type)}`);
	requireId(job.guildId, "guildId");
	optionalText(job.reason, "reason", MAX_REASON_LENGTH);
	optionalText(job.dedupeKey, "dedupeKey", MAX_DEDUPE_KEY_LENGTH);
	if (job.priority !== undefined && (!Number.isSafeInteger(job.priority) || job.priority < 1 || job.priority > MAX_BULLMQ_PRIORITY)) {
		permanentFailure(`priority must be an integer between 1 and ${MAX_BULLMQ_PRIORITY}`);
	}

	switch (job.type) {
		case "deleteMessage":
			requireId(job.channelId, "channelId");
			requireId(job.messageId, "messageId");
			break;
		case "bulkDeleteMessages":
			requireId(job.channelId, "channelId");
			assertNonEmptyIds(job.messageIds, "messageIds", 100);
			break;
		case "banMember":
		case "kickMember":
		case "deleteRole":
			requireId(job.targetId, "targetId");
			break;
		case "removeRoles":
			requireId(job.targetId, "targetId");
			assertNonEmptyIds(job.roleIds, "roleIds", MAX_ROLE_IDS);
			break;
		case "setRoles":
			requireId(job.targetId, "targetId");
			assertIds(job.roleIds, "roleIds", MAX_ROLE_IDS);
			break;
		case "deleteChannel":
			requireId(job.channelId, "channelId");
			break;
		case "createChannel":
			validatePayload(job.payload, CHANNEL_PAYLOAD_KEYS, true, "channel");
			break;
		case "createRole":
			validatePayload(job.payload, ROLE_PAYLOAD_KEYS, true, "role");
			break;
		case "timeoutMember":
			requireId(job.targetId, "targetId");
			if (job.duration !== undefined && (!Number.isSafeInteger(job.duration) || job.duration < 0 || job.duration > MAX_TIMEOUT_MS)) {
				permanentFailure(`duration must be an integer between 0 and ${MAX_TIMEOUT_MS}`);
			}
			break;
		case "editChannel":
			requireId(job.channelId, "channelId");
			validatePayload(job.payload, CHANNEL_PAYLOAD_KEYS, false, "channel");
			break;
		case "editRole":
			requireId(job.targetId, "targetId");
			validatePayload(job.payload, ROLE_PAYLOAD_KEYS, false, "role");
			break;
	}

	let encoded: string;
	try {
		encoded = JSON.stringify(job);
	} catch {
		permanentFailure("Job payload must be JSON serializable");
	}
	if (Buffer.byteLength(encoded!, "utf8") > MAX_PAYLOAD_BYTES) {
		permanentFailure(`Job payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
	}
}

function validatePayload(
	payload: DiscordActionPayload | undefined,
	allowedKeys: ReadonlySet<string>,
	requireName: boolean,
	kind: "channel" | "role",
): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		permanentFailure(`${kind} payload must be an object`);
	}
	const keys = Object.keys(payload);
	if (keys.length === 0) permanentFailure(`${kind} payload must not be empty`);
	for (const key of keys) {
		if (!allowedKeys.has(key)) permanentFailure(`Unsupported ${kind} payload field: ${key}`);
	}
	const name = "name" in payload ? payload.name : undefined;
	if (requireName || name !== undefined) {
		if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
			permanentFailure(`${kind} payload name must contain 1 to 100 characters`);
		}
	}
}

function isActionType(value: unknown): value is DiscordActionType {
	return typeof value === "string" && [
		"deleteMessage", "bulkDeleteMessages", "banMember", "kickMember", "removeRoles", "setRoles",
		"deleteChannel", "createChannel", "deleteRole", "createRole", "timeoutMember", "editChannel", "editRole",
	].includes(value);
}

function requireId(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !SNOWFLAKE_PATTERN.test(value)) {
		permanentFailure(`${field} must be a Discord snowflake`);
	}
}

function assertNonEmptyIds(value: unknown, field: string, max: number): asserts value is string[] {
	assertIds(value, field, max);
	if (value.length === 0) permanentFailure(`${field} must not be empty`);
}

function assertIds(value: unknown, field: string, max: number): asserts value is string[] {
	if (!Array.isArray(value) || value.length > max) permanentFailure(`${field} must contain at most ${max} IDs`);
	for (const id of value) requireId(id, `${field} entry`);
}

function optionalText(value: unknown, field: string, max: number): void {
	if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > max)) {
		permanentFailure(`${field} must contain 1 to ${max} characters`);
	}
}

function permanentFailure(message: string): never {
	throw new UnrecoverableError(message);
}

function isPermanentDiscordError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const record = error as Record<string, unknown>;
	const status = typeof record.status === "number"
		? record.status
		: typeof record.httpStatus === "number" ? record.httpStatus : undefined;
	return status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function defaultReason(type: DiscordActionType): string {
	return `[BOT] Queued ${type}`;
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]): unknown[] {
	return results
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
}

function chunkArray<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
	return chunks;
}
