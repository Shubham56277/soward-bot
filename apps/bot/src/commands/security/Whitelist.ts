import type { User } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNuke } from "@repo/db";
import { env } from "@repo/env";
import { addTrustedUser, normalizeTrustedUsers, parseDiscordUserId, removeTrustedUser } from "../../modules/antiNukeState";
import Help from "../utils/Help";

type UserResolution = { user: User; error?: never } | { user: null; error: string };

export default class WhitelistCommand extends Command {
	constructor() {
		super({
			name: "wl",
			description: {
				content: "Manage full AntiNuke bypasses",
				examples: ["wl @user", "wl 123456789012345678", "wl add @user", "wl remove @user", "wl list"],
				usage: "wl <mention|user-id> | wl <add|remove|list|reset> [user]",
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
				return ctx.sendMessage("Only the server owner, an extra owner, or the AntiNuke admin can manage the whitelist.");
			}

			const sub = (ctx.args[0] ?? "").toLowerCase();
			switch (sub) {
				case "add": return this.addUser(ctx, 1);
				case "remove": return this.removeUser(ctx, 1);
				case "list": return this.listUsers(ctx);
				case "reset": return this.resetAll(ctx);
				case "": return new Help().showCommand(ctx, "wl");
				default: return this.addUser(ctx, 0);
			}
		} catch (error) {
			ctx.client.logger.error("[AntiNuke] Whitelist command failed:", error);
			return ctx.sendMessage("Could not update the AntiNuke whitelist. Please try again.");
		}
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
		if (!resolved.user) return ctx.sendMessage(resolved.error);
		const { user } = resolved;
		if (user.id === ctx.client.user?.id) return ctx.sendMessage("The bot already bypasses its own AntiNuke enforcement.");

		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (trustedUsers.some((entry) => entry.id === user.id)) {
			return ctx.sendMessage(`**${user.username}** already has a full AntiNuke bypass.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id, {
			trustedUsers: addTrustedUser(trustedUsers, user.id),
		});
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		return ctx.sendMessage(`✅ **${user.username}** now has an immediate full AntiNuke bypass.`);
	}

	private async removeUser(ctx: Context, position: number): Promise<any> {
		const resolved = await this.resolveUser(ctx, position);
		if (!resolved.user) return ctx.sendMessage(resolved.error);
		const { user } = resolved;

		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (!trustedUsers.some((entry) => entry.id === user.id)) {
			await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id, user.id);
			return ctx.sendMessage(`**${user.username}** is not whitelisted. Any legacy state was cleared.`);
		}

		const updated = await AntiNuke.update(ctx.guild.id, {
			trustedUsers: removeTrustedUser(trustedUsers, user.id),
		});
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id, user.id);
		return ctx.sendMessage(`✅ **${user.username}** removed from the AntiNuke whitelist.`);
	}

	private async listUsers(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id);
		const trustedUsers = normalizeTrustedUsers(settings.trustedUsers);
		if (!trustedUsers.length) return ctx.sendMessage("No whitelisted users.");

		const lines = await Promise.all(trustedUsers.map(async (entry, index) => {
			try {
				const user = await ctx.client.users.fetch(entry.id);
				return `${index + 1}. **${user.username}** (\`${entry.id}\`)`;
			} catch (error) {
				ctx.client.logger.error(`[AntiNuke] Failed to resolve listed user ${entry.id}:`, error);
				return `${index + 1}. \`${entry.id}\``;
			}
		}));
		return ctx.sendMessage(`## Full AntiNuke Bypasses (${lines.length})\n${lines.join("\n")}`);
	}

	private async resetAll(ctx: Context): Promise<any> {
		const settings = await AntiNuke.get(ctx.guild.id);
		const removedCount = normalizeTrustedUsers(settings.trustedUsers).length;
		const updated = await AntiNuke.update(ctx.guild.id, { trustedUsers: [] });
		await ctx.client.services.antinukes.invalidateGuild(ctx.guild.id, updated);
		await ctx.client.services.antinukes.clearWhitelistState(ctx.guild.id);
		return ctx.sendMessage(`✅ Whitelist cleared (${removedCount} users removed).`);
	}
}
