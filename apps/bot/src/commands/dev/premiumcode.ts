import { PremiumCode } from "@repo/db";
import ms from "@lukeed/ms";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { TimeFormat } from "../../utils/timeFormat";

const MAX_PREMIUM_DURATION_MS = 365 * 24 * 60 * 60 * 1_000;
const MAX_CODE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export default class PremiumCodeCommand extends Command {
	constructor() {
		super({
			name: "premiumcode",
			description: {
				content: "Create a one-time premium activation code",
				examples: ["premiumcode create 30d", "premiumcode create 7d 1d"],
				usage: "premiumcode create <premium duration> [code validity]",
			},
			category: "dev",
			aliases: ["pcode"],
			cooldown: 1,
			args: true,
			permissions: {
				dev: true,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "create",
					description: "Create a one-time activation code",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "duration",
							description: "Premium duration, for example 30d or 12h",
							type: ApplicationCommandOptionType.String,
							required: true,
						},
						{
							name: "valid-for",
							description: "How long the unused code remains valid (default 7d)",
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const action = ctx.options.getSubCommand(false, 0);
		if (action !== "create") return ctx.sendMessage("Use `premiumcode create <duration> [valid-for]`.");

		const durationText = ctx.isInteraction ? ctx.options.getString("duration", true) : ctx.args[1];
		const validityText = (ctx.isInteraction ? ctx.options.getString("valid-for", false) : ctx.args[2]) ?? "7d";
		const durationMs = durationText ? ms.parse(durationText) : 0;
		const validityMs = ms.parse(validityText);

		if (!durationMs || durationMs <= 0 || durationMs > MAX_PREMIUM_DURATION_MS) {
			return ctx.sendMessage("Premium duration must be between 1 second and 365 days.");
		}
		if (!validityMs || validityMs <= 0 || validityMs > MAX_CODE_LIFETIME_MS) {
			return ctx.sendMessage("Code validity must be between 1 second and 30 days.");
		}

		const created = await PremiumCode.create(durationMs, ctx.author!.id, validityMs);
		const content = [
			"Premium activation code (shown only here):",
			`\`${created.code}\``,
			`Premium duration: **${TimeFormat.toHumanize(durationMs)}**`,
			`Code expires: <t:${Math.floor(created.expiresAt.getTime() / 1_000)}:R>`,
		].join("\n");

		if (ctx.isInteraction) return ctx.sendMessage({ content, flags: MessageFlags.Ephemeral });

		await ctx.author!.send(content);
		return ctx.sendMessage("The activation code was sent to your DMs.");
	}
}
