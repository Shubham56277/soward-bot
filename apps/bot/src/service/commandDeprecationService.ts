import { MessageFlags, type Message } from "discord.js";
import type { Redis } from "ioredis";
import type { LegacyCommandMapping } from "../config/legacyCommandMap";

export class CommandDeprecationService {
	public constructor(private readonly redis: Redis) {}

	public async notifyMessage(message: Message, mapping: LegacyCommandMapping): Promise<void> {
		const key = `command:deprecation:${mapping.legacyName}:${message.author.id}`;
		const firstNotice = await this.redis.set(key, "1", "EX", 24 * 60 * 60, "NX");
		if (firstNotice !== "OK") return;
		await message.reply({
			content: `**Command updated**\n-# ${mapping.message}`,
			allowedMentions: { parse: [], repliedUser: false },
			flags: MessageFlags.SuppressNotifications,
		}).catch(() => undefined);
	}
}
