import { Message, Routes } from "discord.js";
import BaseClient from "../../base/Client";
import { purgeMessages } from "../../utils/functions/purgeMessages";
import { AutoMod } from "@repo/db";
import { parse } from "@lukeed/ms";

export class SpamDetector {
	// Configuration with default values
	public config = {
		spamLimit: 7, // Messages within timeWindow to trigger action
		timeWindow: 3000, // 3 seconds in milliseconds
		cooldownPeriod: 30000, // 30 seconds to prevent immediate re-spam
		maxSimilarity: 0.9, // Similarity threshold for duplicate messages
		maxCapsRatio: 0.8, // Maximum allowed caps ratio in message
		minCapsLength: 15, // Minimum message length to check for caps
		minActionDelay: 500, // Minimum delay between actions on same user
		maxEmojis: 10, // Maximum allowed emojis in a single message
		maxClapEmojis: 5, // Maximum allowed clap emojis
		maxEmojiRatio: 0.3, // Maximum ratio of emojis to total characters
		action: "timeout", // Default action
		capsWarningThreshold: 3, // Number of warnings before taking action
		notificationCooldown: 300, // 5 minutes)
	};

	public lastActionTimestamps = new Map<string, number>();
	// Track caps warnings per user
	private capsWarnings = new Map<string, number>();

	constructor(private readonly client: BaseClient) { }

	async checkSpam(message: Message, mod: AutoMod): Promise<{ actionRequired: boolean; reason: string | null; count?: number }> {
		const { author, guild, content } = message;
		const userId = author.id;
		const itIsMe = message.author.id === this.client.user?.id;
		// ignore messages from managr server or admin prams
		if (message.member?.permissions.has("Administrator") || message.member?.permissions.has("ManageGuild")) {
			return { actionRequired: false, reason: null };
		}
		// Skip processing for empty content
		if (!content || content.trim().length === 0) {
			return { actionRequired: false, reason: null };
		}

		// inject config
		if (mod.spam?.spamLimit) this.config.spamLimit = mod.spam.spamLimit;
		if (mod.spam?.maxEmojis) this.config.maxEmojis = mod.spam.maxEmojis;
		if (mod.spam?.action) this.config.action = mod.spam.action;

		// Skip checks for bots, exempt roles/channels
		if (!guild || itIsMe) return { actionRequired: false, reason: null };

		// Check if user is in cooldown
		if (await this.isInCooldown(userId)) {
			return { actionRequired: true, reason: "User in spam cooldown period", count: 0 };
		}

		// Fast path: Message frequency check first (most common trigger)
		const spamCheck = await this.checkMessageFrequency(userId);
		if (spamCheck.isSpamming) {
			return { actionRequired: true, reason: `Message spam (${spamCheck.count} in ${this.config.timeWindow}ms)`, count: spamCheck.count };
		}

		// Advanced checks - only if content is substantial
		if (content.length >= 10 && await this.isDuplicateMessage(userId, content)) {
			return { actionRequired: true, reason: "Duplicate message spam", count: spamCheck.count };
		}

		// Check caps spam with threshold system
		if (content.length >= this.config.minCapsLength) {
			const capsResult = this.handleCapsSpam(userId, content);
			if (capsResult.actionRequired) {
				return { actionRequired: true, reason: capsResult.reason || "Excessive capitalization", count: capsResult.count };
			}
		}

		// Only check emoji spam if content contains possible emojis (optimization)
		if (content.includes("<") || /\p{Emoji}/u.test(content)) {
			const emojiCheck = this.checkEmojiSpam(content);
			if (emojiCheck.isSpamming) {
				return { actionRequired: true, reason: emojiCheck.reason, count: spamCheck.count };
			}
		}

		return { actionRequired: false, reason: null };
	}

	public async checkMessageFrequency(userId: string) {
		const key = `spam:count:${userId}`;
		const count = await this.client.redis.incr(key);

		// Always reset expiry when incrementing to ensure full time window
		await this.client.redis.expire(key, Math.ceil(this.config.timeWindow / 1000));

		return {
			isSpamming: count >= this.config.spamLimit,
			count,
		};
	}

	public async isInCooldown(userId: string): Promise<boolean> {
		const key = `spam:cooldown:${userId}`;
		const timestamp = await this.client.redis.get(key);
		if (timestamp) {
			const cooldownTime = Number.parseInt(timestamp, 10);
			const now = Date.now();
			if (now - cooldownTime < this.config.minActionDelay) {
				return true;
			}
		}

		return false;
	}

	public async isDuplicateMessage(userId: string, content: string) {
		const lastMessageKey = `spam:lastmsg:${userId}`;
		const lastMessage = await this.client.redis.get(lastMessageKey);

		if (lastMessage) {
			// Fast check for exact matches first
			if (content === lastMessage) return true;

			// More sophisticated check only for longer messages
			if (content.length > 20) {
				const similarity = this.calculateSimilarity(content, lastMessage);
				if (similarity > this.config.maxSimilarity) {
					return true;
				}
			}
		}

		await this.client.redis.setex(lastMessageKey, Math.ceil(this.config.timeWindow / 1000), content);
		return false;
	}

	public handleCapsSpam(userId: string, content: string): { actionRequired: boolean; reason: string | null; count?: number } {
		// Skip short messages
		if (content.length < this.config.minCapsLength) return { actionRequired: false, reason: null };

		// Count uppercase letters
		const capsCount = (content.match(/[A-Z]/g) || []).length;
		// Calculate ratio based on alphanumeric characters, not special chars
		const alphaChars = content.match(/[a-zA-Z0-9]/g) || [];
		if (alphaChars.length === 0) return { actionRequired: false, reason: null };

		const capsRatio = capsCount / alphaChars.length;

		if (capsRatio > this.config.maxCapsRatio) {
			// Increment warning counter for this user
			const currentWarnings = (this.capsWarnings.get(userId) || 0) + 1;
			this.capsWarnings.set(userId, currentWarnings);

			// Set a timeout to clear the warning after some time
			setTimeout(() => {
				const warnings = this.capsWarnings.get(userId) || 0;
				if (warnings > 0) {
					this.capsWarnings.set(userId, warnings - 1);
				}
			}, 60000); // Reset one warning after 1 minute

			// Only take action if warnings exceed threshold
			if (currentWarnings >= this.config.capsWarningThreshold) {
				return {
					actionRequired: true,
					reason: `Excessive capitalization (${currentWarnings} warnings)`,
					count: currentWarnings
				};
			}

			// No action yet, but count warnings
			return {
				actionRequired: false,
				reason: null
			};
		}

		return { actionRequired: false, reason: null };
	}

	/**
	 * Check if a notification can be sent to the user
	 * @param userId User ID to check
	 * @returns Whether notification can be sent
	 */
	private async canSendNotification(userId: string): Promise<boolean> {
		const notificationKey = `spam:notification:${userId}`;
		const exists = await this.client.redis.exists(notificationKey);
		return exists === 0; // Return true if key doesn't exist
	}

	/**
	 * Set notification cooldown for a user
	 * @param userId User ID to set cooldown for
	 */
	private async setNotificationCooldown(userId: string): Promise<void> {
		const notificationKey = `spam:notification:${userId}`;
		await this.client.redis.setex(
			notificationKey,
			this.config.notificationCooldown,
			Date.now().toString()
		);
	}

	async takeAction(message: Message, reason: string, duration?: number) {
		if (!message.guild) return;

		const guildId = message.guildId!;
		const userId = message.author.id;

		// Prevent rapid actions on same user
		const lastAction = this.lastActionTimestamps.get(userId) || 0;
		if (Date.now() - lastAction < this.config.minActionDelay) {
			return;
		}

		// Set processing flag immediately
		this.lastActionTimestamps.set(userId, Date.now());

		const cooldownKey = `spam:cooldown:${userId}`;
		const processingKey = `spam:processing:${userId}`;
		const cooldownSeconds = Math.max(1, Math.ceil(this.config.cooldownPeriod / 1000));

		try {
			// Use Redis SETNX for locking (returns 1 if set, 0 if already exists)
			const isProcessing = await this.client.redis.setnx(processingKey, Date.now().toString());
			if (isProcessing === 0) {
				return; // Already being processed by another instance
			}

			// Set short expiry on processing key
			await this.client.redis.expire(processingKey, 5);

			// Reset caps warnings when taking action
			if (reason.includes("capitalization")) {
				this.capsWarnings.delete(userId);
			}

			// Batched Redis operations for performance
			const pipeline = this.client.redis.multi();

			// Check if we can send a notification to the user
			const canNotify = await this.canSendNotification(userId);

			switch (this.config.action) {
				case "ban": {
					await this.client.rest
						.put(Routes.guildBan(guildId, userId), {
							body: { delete_message_seconds: 86400 },
							reason: `Spam detected: ${reason}`,
						})
						.catch(() => { });

					// Only send notification if user hasn't been notified recently
					if (canNotify && !message.channel.isThread() && !message.channel.isDMBased()) {
						const success = await message.channel.send({
							embeds: [
								{
									title: "Spam detected",
									description: `\`${message.author.username}\` has been banned\nReason: ${reason}`,
									color: this.client.config.colors.red,
								},
							],
						});

						// Set notification cooldown for this user
						await this.setNotificationCooldown(userId);

						setTimeout(async () => {
							await success.delete().catch(() => { });
						}, 60 * 1000);
					}
					break;
				}

				case "kick": {
					await this.client.rest
						.delete(Routes.guildMember(guildId, userId), {
							reason: `Spam detected: ${reason}`,
						})
						.catch(() => { });

					// Only send notification if user hasn't been notified recently
					if (canNotify && !message.channel.isThread() && !message.channel.isDMBased()) {
						const success = await message.channel.send({
							embeds: [
								{
									title: "Spam detected",
									description: `\`${message.author.username}\` has been kicked\nReason: ${reason}`,
									color: this.client.config.colors.red,
								},
							],
						});

						// Set notification cooldown for this user
						await this.setNotificationCooldown(userId);

						setTimeout(async () => {
							await success.delete().catch(() => { });
						}, 60 * 1000);
					}
					break;
				}

				case "timeout": {
					const user = await message.guild?.members.fetch(userId).catch(() => { });
					if (user) {
						await user.timeout(parse("1h")!, `Spam detected: ${reason}`).catch(() => { });
					}

					// Only send notification if user hasn't been notified recently
					if (canNotify && !message.channel.isThread() && !message.channel.isDMBased()) {
						const success = await message.channel.send({
							embeds: [
								{
									title: "Spam detected",
									description: `\`${message.author.username}\` has been timed out\nReason: ${reason}`,
									color: this.client.config.colors.red,
								},
							],
						});

						// Set notification cooldown for this user
						await this.setNotificationCooldown(userId);

						setTimeout(async () => {
							await success.delete().catch(() => { });
						}, 60 * 1000);
					}
					break;
				}

				case "warn": {
					// Only send DM if user hasn't been notified recently
					if (canNotify) {
						const user = await this.client.users.fetch(userId).catch(() => { });
						if (user) {
							await user
								.send({
									embeds: [
										{
											title: "Spam warning",
											description: `You have been warned for spamming in this server\nReason: ${reason}`,
											color: this.client.config.colors.orange,
										},
									],
									components: [
										{
											type: 1,
											components: [
												{
													type: 2,
													label: `Message From: ${message.guild?.name}`,
													custom_id: `view_message:${message.id}`,
													disabled: true,
													style: 2,
												},
											],
										},
									],
								})
								.catch(() => { });

							// Set notification cooldown for this user
							await this.setNotificationCooldown(userId);
						}
					}
					break;
				}
			}

			// Delete spam messages (with debounce)
			const totalMessages = await this.client.redis.get(`spam:count:${userId}`);
			const messageCount = Number(totalMessages) || 0;
			if (messageCount > 1) {
				setTimeout(async () => {
					await purgeMessages(message.guild!.members.me!, message.channel, "USER", messageCount - 1, message.author.id);
				}, 1000);
			}

			// Execute cleanup operations in a single pipeline
			pipeline
				.setex(cooldownKey, cooldownSeconds, Date.now().toString())
				.del(`spam:count:${userId}`)
				.del(processingKey);

			await pipeline.exec();

		} catch (error) {
			console.error(`Failed to take action ${this.config.action} on user ${userId}:`, error);
			// Ensure we clean up processing key on error
			await this.client.redis.del(processingKey).catch(() => { });
		}
	}

	private calculateSimilarity(str1: string, str2: string): number {
		// Simple string equality check first
		if (str1 === str2) return 1.0;

		// Fast-fail check: different lengths
		const lengthDiff = Math.abs(str1.length - str2.length);
		const longerLength = Math.max(str1.length, str2.length);

		// If length difference is too great, they're not similar
		if (lengthDiff / longerLength > 0.3) return 0.0;

		// Optimized similarity check for similar-length strings
		const longer = str1.length > str2.length ? str1 : str2;
		const shorter = str1.length > str2.length ? str2 : str1;

		if (longerLength === 0) return 1.0;

		// Use faster Levenshtein distance calculation
		return (longerLength - this.fastLevenshtein(longer.toLowerCase(), shorter.toLowerCase())) / longerLength;
	}

	private fastLevenshtein(s1: string, s2: string): number {
		// More efficient Levenshtein implementation
		if (s1 === s2) return 0;
		if (s1.length === 0) return s2.length;
		if (s2.length === 0) return s1.length;

		// Only keep current and previous row to save memory
		let prevRow = Array(s2.length + 1);
		let curRow = Array(s2.length + 1);

		// Initialize the previous row
		for (let j = 0; j <= s2.length; j++) {
			prevRow[j] = j;
		}

		// Calculate rows
		for (let i = 0; i < s1.length; i++) {
			curRow[0] = i + 1;

			for (let j = 0; j < s2.length; j++) {
				const cost = s1.charAt(i) === s2.charAt(j) ? 0 : 1;
				curRow[j + 1] = Math.min(
					curRow[j] + 1,                // deletion
					prevRow[j + 1] + 1,           // insertion
					prevRow[j] + cost             // substitution
				);
			}

			// Swap rows
			[prevRow, curRow] = [curRow, prevRow];
		}

		return prevRow[s2.length];
	}

	public checkEmojiSpam(content: string): { isSpamming: boolean; reason: string | null } {
		// Skip checking very short content
		if (content.length < 5) return { isSpamming: false, reason: null };

		// First remove all URLs to avoid false positives
		const urlRegex = /https?:\/\/[^\s]+/g;
		const contentWithoutUrls = content.replace(urlRegex, "");

		// Also remove discord API links
		const discordApiRegex = /discord(?:app)?\.com\/api\/\S+/g;
		const cleanContent = contentWithoutUrls.replace(discordApiRegex, "");

		// Match valid custom emojis (<:name:1234567890>) and Unicode emojis
		const emojiRegex = /<a?:\w+:\d+>|\p{Emoji}/gu;
		const emojis = cleanContent.match(emojiRegex) || [];

		// Reduce false positives
		const validEmojis = emojis.filter(emoji => !/^\d+$/.test(emoji.replace(/[<>:]/g, "")));

		// Quick return if emoji count is well below limit
		if (validEmojis.length <= this.config.maxEmojis / 2) {
			return { isSpamming: false, reason: null };
		}

		// Check for too many emojis overall
		if (validEmojis.length > this.config.maxEmojis) {
			return {
				isSpamming: true,
				reason: `Too many emojis (${validEmojis.length} exceeds limit of ${this.config.maxEmojis})`,
			};
		}

		// Check emoji ratio using original content length
		if (cleanContent.length > 0) {
			const emojiRatio = validEmojis.length / cleanContent.length;
			if (emojiRatio > this.config.maxEmojiRatio) {
				return {
					isSpamming: true,
					reason: `Message contains too many emojis (${(emojiRatio * 100).toFixed(0)}% of content)`,
				};
			}
		}

		return { isSpamming: false, reason: null };
	}
}