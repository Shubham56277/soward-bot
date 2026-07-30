import { AFK } from "@repo/db";
import { Message } from "discord.js";

/**
 * Formats a relative time string like "20s ago", "5m ago", "2h ago"
 */
function timeAgo(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export async function handleAfk(message: Message) {
	if (message.author.bot || message.author.system || !message.guild) return;

	// Handle user returning from AFK
	const userAfk = await AFK.get(message.author.id);
	if (userAfk) {
		// Check if this AFK applies to the current context
		const applies = userAfk.global || userAfk.guildId === message.guild.id;

		if (applies) {
			await AFK.delete(message.author.id);

			let content = `**${message.author.username}** is no longer AFK.`;
			if (userAfk.mentionBy?.length) {
				content += `\n-# You were mentioned ${userAfk.mentionBy.length} time(s) while away.`;
			}

			await message.reply({
				content,
				allowedMentions: { parse: [], repliedUser: false },
			}).catch(() => {});
			return;
		}
	}

	// Handle mentions of AFK users (runs regardless of author's AFK status)
	if (message.mentions.users.size === 0) return;

	for (const user of message.mentions.users.values()) {
		if (user.id === message.author.id) continue;
		if (user.bot) continue;
		if (user.system) continue;
		if (user.id === message.client.user?.id) continue;

		const afkUser = await AFK.get(user.id);
		if (!afkUser) continue;

		// Check if this AFK applies in the current guild
		const afkApplies = afkUser.global || afkUser.guildId === message.guild!.id;
		if (!afkApplies) continue;

		const reason = afkUser.reason || "No reason provided.";
		const ago = afkUser.createdAt ? timeAgo(new Date(afkUser.createdAt)) : "just now";

		await message.reply({
			content: `**${user.username}** is AFK - ${reason}\n-# AFK ${ago}`,
			allowedMentions: { parse: [], repliedUser: false },
		}).catch(() => {});

		await AFK.update(user.id, {
			mentionBy: afkUser.mentionBy ? [...afkUser.mentionBy, { id: message.author.id }] : [{ id: message.author.id }],
		});
	}
}
