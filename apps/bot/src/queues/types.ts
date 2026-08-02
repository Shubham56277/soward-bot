/**
 * Job data types for all centralized BullMQ queues.
 */

export interface TempPunishmentJob {
	type: "unban" | "unmute"
	guildId: string
	userId: string
	reason: string
}

export interface ReminderJob {
	userId: string
	channelId: string
	guildId: string
	message: string
}

export interface ModerationLogJob {
	guildId: string
	action: string
	targetId: string
	moderatorId: string
	reason: string
}

export interface AnalyticsJob {
	type: string
	guildId: string
	data: Record<string, unknown>
}

export interface ScheduledMessageJob {
	guildId: string
	channelId: string
	content: string
}

export interface AiChannelRequestJob {
	guildId: string
	channelId: string
	userId: string
	messageId: string
	question: string
}
