import { env } from "@repo/env";
import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { BrandingRateLimitError, updateGlobalUsername } from "../../utils/botBranding";
import { reportError } from "../../utils/errorHandler";
import { validateBotUsername } from "../../utils/botUsername";

/** Developer-only prefix command for changing the bot account's global username. */
export default class Rename extends Command {
	public constructor() {
		super({
			name: "rename",
			description: {
				content: "Change the bot account's global Discord username",
				usage: "rename <new username>",
				examples: ["rename Elfaria"],
			},
			category: "dev",
			cooldown: 5,
			args: false,
			slashCommand: false,
			permissions: { dev: true, client: ["SendMessages", "ViewChannel"], user: [] },
		});
	}

	public async run(ctx: Context, args: string[]): Promise<any> {
		// Defense in depth: message dispatch also enforces permissions.dev.
		if (!ctx.author || !env.DEVELOPER_IDS.includes(ctx.author.id)) return;

		const validation = validateBotUsername(args.join(" "));
		if (!validation.ok) return this.reply(ctx, validation.reason);

		const currentUsername = ctx.client.user?.username;
		if (!currentUsername) return this.reply(ctx, "The Discord client is not ready. Try again after the bot reconnects.");
		if (currentUsername === validation.username) {
			return this.reply(ctx, `The global bot username is already \`${validation.username}\`.`);
		}

		try {
			await updateGlobalUsername(ctx.client, validation.username);
			return this.reply(ctx, `Global bot username changed from \`${currentUsername}\` to \`${validation.username}\`. This applies in every server.`);
		} catch (error) {
			await reportError(ctx.client, error, {
				source: "prefix",
				command: "rename",
				guildId: ctx.guild.id,
				userId: ctx.author.id,
				messageId: ctx.message?.id,
			});

			if (error instanceof BrandingRateLimitError) {
				return this.reply(ctx, `Discord is rate-limiting global username changes. Try again in about ${error.retryAfterSeconds} seconds.`);
			}
			const apiError = error as { status?: number; code?: number | string };
			if (apiError?.status === 400 || apiError?.code === 50035) {
				return this.reply(ctx, "Discord rejected that username. Check its characters and length, then try another name.");
			}
			return this.reply(ctx, "The global username could not be changed because Discord is temporarily unavailable. Try again later.");
		}
	}

	private reply(ctx: Context, content: string): Promise<any> {
		return ctx.sendMessage({
			content,
			allowedMentions: { parse: [], repliedUser: false },
			flags: MessageFlags.SuppressNotifications,
		});
	}
}
