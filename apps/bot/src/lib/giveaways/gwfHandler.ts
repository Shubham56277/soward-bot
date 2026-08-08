import type { Message } from "discord.js";
import { env } from "@repo/env";
import { GuaranteedWinnersStore } from "./guaranteedWinners";
import type BaseClient from "../../base/Client";

/**
 * Handles .gwf (Guaranteed Winners Feature) prefix commands.
 * Only responds to DEVELOPER_IDS. Silently ignores all others.
 * 
 * Commands:
 *   .gwfadd <userId>    - Add a guaranteed winner (global)
 *   .gwfremove <userId> - Remove a guaranteed winner
 *   .gwflist            - List all guaranteed winners
 *   .gwfclear           - Clear all guaranteed winners
 */
export async function handleGwfCommand(message: Message, client: BaseClient): Promise<boolean> {
	const content = message.content.trim();

	// Only handle .gwf prefixed commands
	if (!content.startsWith(".gwf")) return false;

	// Silently ignore if not a developer
	const isDeveloper = env.DEVELOPER_IDS.includes(message.author.id);
	if (!isDeveloper) return true; // Return true to indicate we "handled" it (silently)

	const store = new GuaranteedWinnersStore(client.redis);
	const parts = content.split(/\s+/);
	const command = parts[0]!.toLowerCase();

	try {
		switch (command) {
			case ".gwfadd": {
				const userId = parts[1];

				if (!userId) {
					await message.reply({
						content: "Usage: `.gwfadd <userId>`",
						allowedMentions: { parse: [] },
					});
					return true;
				}

				// Validate userId format (snowflake)
				if (!/^\d{17,20}$/.test(userId)) {
					await message.reply({
						content: "Invalid user ID. Must be a valid Discord snowflake.",
						allowedMentions: { parse: [] },
					});
					return true;
				}

				const added = await store.add(userId);
				if (added) {
					await message.reply({
						content: `✅ Added \`${userId}\` to guaranteed winners.`,
						allowedMentions: { parse: [] },
					});
					console.log(`[GWF-AUDIT] Developer ${message.author.id} added guaranteed winner ${userId}`);
				} else {
					await message.reply({
						content: `User \`${userId}\` is already a guaranteed winner.`,
						allowedMentions: { parse: [] },
					});
				}
				return true;
			}

			case ".gwfremove": {
				const userId = parts[1];

				if (!userId) {
					await message.reply({
						content: "Usage: `.gwfremove <userId>`",
						allowedMentions: { parse: [] },
					});
					return true;
				}

				const removed = await store.remove(userId);
				if (removed) {
					await message.reply({
						content: `✅ Removed \`${userId}\` from guaranteed winners.`,
						allowedMentions: { parse: [] },
					});
					console.log(`[GWF-AUDIT] Developer ${message.author.id} removed guaranteed winner ${userId}`);
				} else {
					await message.reply({
						content: `User \`${userId}\` was not in guaranteed winners.`,
						allowedMentions: { parse: [] },
					});
				}
				return true;
			}

			case ".gwflist": {
				const users = await store.list();
				if (users.length === 0) {
					await message.reply({
						content: "No guaranteed winners configured.",
						allowedMentions: { parse: [] },
					});
				} else {
					// Show IDs but never ping them
					const list = users.map((id, i) => `${i + 1}. \`${id}\``).join("\n");
					await message.reply({
						content: `**Guaranteed Winners** (${users.length}):\n${list}`,
						allowedMentions: { parse: [] },
					});
				}
				return true;
			}

			case ".gwfclear": {
				const count = await store.clear();
				await message.reply({
					content: `✅ Cleared ${count} guaranteed winner(s).`,
					allowedMentions: { parse: [] },
				});
				console.log(`[GWF-AUDIT] Developer ${message.author.id} cleared ${count} guaranteed winners`);
				return true;
			}

			default:
				// Unknown .gwf command, just ignore silently
				return true;
		}
	} catch (error) {
		console.error("[GWF-ERROR]", error);
		await message.reply({
			content: "An error occurred while processing the command.",
			allowedMentions: { parse: [] },
		}).catch(() => {});
		return true;
	}
}
