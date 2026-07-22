// utils/MessageTracker.ts
import { Message } from "discord.js";
import Redis from "ioredis";

interface SnipedMessage {
	messageId: string;
	content: string;
	author: string;
	authorId: string;
	timestamp: number;
	image?: string;
	authorAvatar?: string;
}

interface EditSnipedMessage extends SnipedMessage {
	oldContent: string;
	editTimestamp: number;
	authorAvatar?: string;
}

class MessageTracker {
	private readonly deletedKeyPrefix = "snipes:deleted:";
	private readonly editedKeyPrefix = "snipes:edited:";
	private readonly maxStored = 25;
	private readonly maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

	private getDeletedKey(channelId: string) {
		return `${this.deletedKeyPrefix}${channelId}`;
	}

	private getEditedKey(channelId: string) {
		return `${this.editedKeyPrefix}${channelId}`;
	}

	private async cleanupOldMessages(redis: Redis, key: string) {
		const cutoffTime = Date.now() - this.maxAge;
		const messages = await redis.lrange(key, 0, -1);

		// Filter out messages older than maxAge
		const validMessages = messages.filter(msgStr => {
			try {
				const msg = JSON.parse(msgStr);
				return msg.timestamp > cutoffTime;
			} catch {
				return false; // Remove invalid JSON
			}
		});

		// If we removed any messages, update the list
		if (validMessages.length !== messages.length) {
			if (validMessages.length === 0) {
				await redis.del(key);
			} else {
				// Clear the list and repopulate with valid messages
				await redis.del(key);
				if (validMessages.length > 0) {
					await redis.lpush(key, ...validMessages);
				}
			}
		}
	}

	public async addDeletedMessage(message: Message) {
		if (message.author.bot) return;
		const redis = message.client.redis;
		const snipe: SnipedMessage = {
			messageId: message.id,
			content: message.content,
			author: message.author.tag,
			authorId: message.author.id,
			timestamp: Date.now(),
			authorAvatar: message.author.displayAvatarURL(),
		};

		const image = message.attachments.find((a) => a.contentType?.startsWith("image/") || a.url.match(/\.(png|jpe?g|gif)$/i));
		if (image) snipe.image = image.url;

		const key = this.getDeletedKey(message.channel.id);

		// Clean up old messages first
		await this.cleanupOldMessages(redis, key);

		// Add new message
		await redis.lpush(key, JSON.stringify(snipe));
		await redis.ltrim(key, 0, this.maxStored - 1);

		// Set expiration on the key to ensure Redis cleanup
		await redis.expire(key, Math.ceil(this.maxAge / 1000));
	}

	public async addEditedMessage(oldMessage: Message, newMessage: Message) {
		if (oldMessage.author.bot || newMessage.author.bot) return;

		const redis = newMessage.client.redis;
		const snipe: EditSnipedMessage = {
			messageId: newMessage.id,
			content: newMessage.content,
			oldContent: oldMessage.content,
			author: newMessage.author.tag,
			authorId: newMessage.author.id,
			timestamp: oldMessage.createdTimestamp,
			editTimestamp: Date.now(),
			authorAvatar: newMessage.author.displayAvatarURL(),
		};

		const key = this.getEditedKey(newMessage.channel.id);

		// Clean up old messages first
		await this.cleanupOldMessages(redis, key);

		// Add new message
		await redis.lpush(key, JSON.stringify(snipe));
		await redis.ltrim(key, 0, this.maxStored - 1);

		// Set expiration on the key to ensure Redis cleanup
		await redis.expire(key, Math.ceil(this.maxAge / 1000));
	}

	public async getDeletedMessages(redis: Redis, channelId: string): Promise<SnipedMessage[]> {
		const key = this.getDeletedKey(channelId);

		// Clean up old messages before returning
		await this.cleanupOldMessages(redis, key);

		const raw = await redis.lrange(key, 0, -1);
		return raw.map((r) => JSON.parse(r));
	}

	public async getEditedMessages(redis: Redis, channelId: string): Promise<EditSnipedMessage[]> {
		const key = this.getEditedKey(channelId);

		// Clean up old messages before returning
		await this.cleanupOldMessages(redis, key);

		const raw = await redis.lrange(key, 0, -1);
		return raw.map((r) => JSON.parse(r));
	}

	// Optional: Method to manually clean up all channels
	public async cleanupAllChannels(redis: Redis) {
		const deletedKeys = await redis.keys(`${this.deletedKeyPrefix}*`);
		const editedKeys = await redis.keys(`${this.editedKeyPrefix}*`);

		const allKeys = [...deletedKeys, ...editedKeys];

		for (const key of allKeys) {
			await this.cleanupOldMessages(redis, key);
		}
	}
}

export const messageTracker = new MessageTracker();