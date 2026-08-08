import { ApplicationCommandOptionType, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

export default class Warns extends Command {
	constructor() {
		super({
			name: "warns",
			description: {
				content: "View warning history for a member",
				examples: ["warns @user", "warns 123456789012345678"],
				usage: "warns <user>",
			},
			category: "moderation",
			aliases: ["warnings", "modlogs"],
			cooldown: 5,
			args: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel"],
				user: ["ModerateMembers"],
			},
			slashCommand: true,
			options: [
				{ name: "user", description: "User to check warnings for", type: ApplicationCommandOptionType.User, required: true },
			],
		});
	}

	/** Truncate a string to a maximum length, adding ellipsis if needed. */
	private truncate(text: string, maxLen: number): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen - 3) + "...";
	}

	public async run(ctx: Context): Promise<any> {
		const user = ctx.options.getUser("user", true, 0);
		if (!user) {
			return ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Please specify a valid user."))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const warnings = await Warning.getUserWarnings(ctx.guild.id, user.id);

		if (!warnings.length) {
			return ctx.sendMessage({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Warning History**\n────────────────────\nUser: ${user.username}\n\nNo warnings found.`,
				))],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		const lines = warnings.slice(0, 10).map((w, i) => {
			const date = `<t:${Math.floor(w.createdAt.getTime() / 1000)}:R>`;
			const reason = this.truncate(w.reason, 50);
			const moderator = ctx.guild?.members.cache.get(w.moderatorId)?.user.username ?? w.moderatorId;
			return `\`${i + 1}.\` ${reason}\n-# By ${moderator} ${date} — ID: ${this.truncate(w.id, 12)}`;
		});

		const body = [
			`**Warning History**`,
			`────────────────────`,
			`User: ${user.username}`,
			`Total: ${warnings.length}`,
			"",
			...lines,
			...(warnings.length > 10 ? [`\n-# ...and ${warnings.length - 10} more`] : []),
		].join("\n");

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

		return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
	}
}
