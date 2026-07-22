import { User } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import ms from "@lukeed/ms";
import { TimeFormat } from "../../utils/timeFormat";

export default class NoPrefix extends Command {
	constructor() {
		super({
			name: "np",
			description: {
				content: "Toggle or set no-prefix status for a user",
				examples: ["noprefix @user", "noprefix @user 1h", "noprefix @user 30m", "noprefix @user remove"],
				usage: "noprefix <user> [duration|remove]",
			},
			category: "dev",
			aliases: ["nprefix"],
			cooldown: 5,
			args: true,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: true,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
			},
			slashCommand: false,
		});
	}

	public async run(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", false, 0);
		const duration = ctx.options.getString("duration", false, 1) || "30day";

		if (!user) {
			return ctx.sendMessage("Please specify a user to manage no-prefix for.");
		}

		const hasNoPrefix = await User.getNoPrefix(user.id);

		// If no duration specified, toggle the status
		if (!duration) {
			if (hasNoPrefix) {
				await User.update(user.id, {
					noPrefix: false,
					noPrefixExpiresAt: null,
				});
				return ctx.sendMessage(`<:Tick:1375519268292264012> Removed no-prefix from <@${user.id}>.`);
			}
			await User.update(user.id, { noPrefix: true });
			return ctx.sendMessage(`<:Tick:1375519268292264012> Gave <@${user.id}> no-prefix **indefinitely**.`);
		}

		// Handle explicit removal
		if (duration.toLowerCase() === "remove") {
			if (!hasNoPrefix) {
				return ctx.sendMessage(`<@${user.id}> doesn't have no-prefix enabled.`);
			}
			await User.update(user.id, {
				noPrefix: false,
				noPrefixExpiresAt: null,
			});
			return ctx.sendMessage(`<:Tick:1375519268292264012> Removed no-prefix from <@${user.id}>.`);
		}

		// Handle duration setting
		try {
			const durationMs = ms.parse(duration);
			if (!durationMs || durationMs <= 0) {
				return ctx.sendMessage('Invalid duration format. Use something like "1h" or "30m".');
			}

			await User.setNoPrefix(user.id, durationMs, ctx.author?.id ?? user.id);
			const formattedDuration = TimeFormat.toHumanize(durationMs);

			return ctx.sendMessage(hasNoPrefix ? `<:Tick:1375519268292264012> Updated <@${user.id}>'s no-prefix to expire in **${formattedDuration}**.` : `<:Tick:1375519268292264012> Gave <@${user.id}> no-prefix for **${formattedDuration}**.`);
		} catch {
			return ctx.sendMessage('Invalid duration format. Use something like "1h" or "30m".');
		}
	}
}
