import { AntiNuke } from "@repo/db";

/** Canonical database-backed trust lookup used by hierarchy policies. */
export class AntiNukeService {
	static async isTrusted(guildId: string, userId: string): Promise<boolean> {
		const settings = await AntiNuke.get(guildId);
		return settings.trustedUsers.some((user) => user.id === userId);
	}
}
