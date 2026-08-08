import { AntiNuke } from "@repo/db";
import { env } from "@repo/env";
import { MessageFlags, type User } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
	addTrustedUser,
	normalizeTrustedUsers,
	parseDiscordUserId,
	removeTrustedUser,
} from "../../modules/antiNukeState";
import {
	ANTINUKE_ARROW,
	ANTINUKE_LOCK,
	ANTINUKE_TICK,
	ANTINUKE_WARNING,
	buildAntiNukePanel,
} from "../../modules/antiNukeUi";

type UserResolution = { user: User; error?: never } | { user: null; error: string };

function reply(ctx: Context, title: string, body: string): Promise<any> {
	return ctx.sendMessage({
		components: [buildAntiNukePanel(title, [body])],
		flags: MessageFlags.IsComponentsV2,
		allowedMentions: { parse: [] },
	});
}

export default class WhitelistCommand extends Command {
	constructor() {
		super({
			name: "wl",
			description: {
				content: "Manage full AntiNuke bypasses",
				examples: ["wl @user", "wl 123456789012345678", "wl remove @user", "wl list"],
				usage: "wl <mention|user-id> | wl <remove|list|reset> [user]",
			},
			category: "security",
			aliases: ["whitelist"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			if (!(await this.isAuthorized(ctx))) {
				return reply(ctx, "Access Denied", `${ANTINUKE_LOCK} Only the server owner, an extra owner, or the AntiNuke admin can manage bypasses.`);
			}

			const sub = (ctx.args[0] ?? "").toLowerCase();
			switch (sub) {
				case "add": return this.addUser(ctx, 1);
				case "remove": return this.removeUser(ctx, 1);
				case "list": return this.listUsers(ctx);
				case "reset": return this.resetAll(ctx);
				case "": return this.showHelp(ctx);
				default: return this.addUser(ctx, 0);
			}
		} catch (error) {
			ctx.client.logger.error("[AntiNuke] Whitelist command failed:", error);
			return reply(ctx, "Whitelist Error", `${ANTINUKE_WARNING} Could not update AntiNuke bypasses. Please try again.`);
		}
	}

	private showHelp(ctx: Context): Promise<any> {
		return reply(ctx, "Full AntiNuke Bypasses", [
			"A direct target grants a full owner-like bypass for normal AntiNuke enforcement.",
			"",
			`${ANTINUKE_ARROW} \`?wl <mention|userId>\` — Add a full bypass`,
			`${ANTINUKE_ARROW} \`?wl remove <mention|userId>\` — Remove a bypass`,
			`${ANTINUKE_ARROW} \`?wl list\` — List bypasses`,
			`${ANTINUKE_ARROW} \`?wl reset\` — Clear bypasses`,
			"",
			"-# Infinite Void remains an emergency override at its confirmed-kick threshold.",
		].join("\n"));
	}

	private async isAuthorized(ctx: Context): Promise<boolean> {
		const userId = ctx.author?.id ?? "";
		if (userId === ctx.guild.ownerId || env.DEVELOPER_IDS.includes(userId)) return true;
		try {
			const raw = await ctx.client.redis.get(`extraowners:${ctx.guild.id}`);
			if (raw) {
				const owners = JSON.parse(raw) as { userId: string }[];
				if (owners.some((owner) => owner.userId === userId)) return true;
			}
		} catch (error) {
			ctx.client.logger.error("[AntiNuke] Failed to read extra owners:", error);
		}
		return (await AntiNuke.get(ctx.guild.id)).admin === userId;
	}

	private async resolveUser(ctx: Context, position: number): Promise<UserResolution> {
		const raw = ctx.args[position];
		const userId = parseDiscordUserId(raw);
		if (!userId) return { user: null, error: "Provide a valid user mention or 17-20 digit Discord user ID." };
		try {
			const member = await ctx.guild.members.fetch(userId);
			return { user: member.user };
		} catch {
			try {
				return { user: await ctx.client.users.fetch(userId) };
			} catch (error) {
				ctx.client.logger.error(`[AntiNuke] Failed to resolve whitelist user ${userId}:`, error);
				return { user: null, error: `No Discord user could be resolved for \`${userId}\`.` };
			}
		}
	}

	private async addUser(ctx: Context, position: number): Promise<any> {
		const resolved = await this.resolveUser(ctx, position);
		if (!resolved.user) return reply(ctx, "Invalid User", `${ANTINUKE_WARNING} ${resolved.error}`);
		const { user } = resolved;
		if (user.id === ctx.client.user?.id) return reply(ctx, "Already Protected", "The bot already bypasses its own normal AntiNuke enforcement.");

		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (trustedUsers.some((entry) => entry.id === user.id)) {
			return reply(ctx, "Already Whitelisted", `**${user.username}** already has a full AntiNuke bypass.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id, {
			trustedUsers: addTrustedUser(trustedUsers, user.id),
		});
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		return reply(ctx, "Whitelist Updated", `${ANTINUKE_TICK} **${user.username}** now has an immediate full normal AntiNuke bypass.`);
	}

	private async removeUser(ctx: Context, position: number): Promise<any> {
		const resolved = await this.resolveUser(ctx, position);
		if (!resolved.user) return reply(ctx, "Invalid User", `${ANTINUKE_WARNING} ${resolved.error}`);
		const { user } = resolved;

		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (!trustedUsers.some((entry) => entry.id === user.id)) {
			await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id, user.id);
			return reply(ctx, "Not Whitelisted", `**${user.username}** is not whitelisted. Any legacy state was cleared.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id, {
			trustedUsers: removeTrustedUser(trustedUsers, user.id),
		});
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id, user.id);
		return reply(ctx, "Whitelist Updated", `${ANTINUKE_TICK} **${user.username}** was removed from the AntiNuke whitelist.`);
	}

	private async listUsers(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (!trustedUsers.length) return reply(ctx, "Full AntiNuke Bypasses", "No users are currently whitelisted.");

		const lines = await Promise.all(trustedUsers.map(async (entry, index) => {
			try {
				const user = await ctx.client.users.fetch(entry.id);
				return `\`${index + 1}.\` **${user.username}** (\`${entry.id}\`)`;
			} catch (error) {
				ctx.client.logger.error(`[AntiNuke] Failed to resolve listed user ${entry.id}:`, error);
				return `\`${index + 1}.\` \`${entry.id}\``;
			}
		}));
		return reply(ctx, `Full AntiNuke Bypasses (${lines.length})`, lines.join("\n"));
	}

	private async resetAll(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id);
		const removedCount = normalizeTrustedUsers(settings.trustedUsers).length;
		const updated = await AntiNuke.update(ctx.guild.id, { trustedUsers: [] });
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id);
		return reply(ctx, "Whitelist Cleared", `${ANTINUKE_TICK} Removed ${removedCount} full AntiNuke bypass${removedCount === 1 ? "" : "es"}.`);
	}
}
