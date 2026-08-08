import { ApplicationCommandOptionType, TextChannel, ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Help from "../utils/Help";

export default class Slowmode extends Command {
	/** Helper to send a component based error message that auto‑deletes after a short delay. */
	private async sendError(ctx: Context, content: string, deleteAfterMs = 5_000) {
		const container = new ContainerBuilder().addTextDisplayComponents(
			new TextDisplayBuilder().setContent(content)
		);
		const msg = await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		if (msg && deleteAfterMs > 0) {
			setTimeout(() => msg.delete?.().catch(() => undefined), deleteAfterMs).unref();
		}
		return msg;
	}

	/** Helper to send a component based success message that auto‑deletes after a short delay. */
	private async sendSuccess(ctx: Context, content: string, deleteAfterMs = 5_000) {
		const container = new ContainerBuilder().addTextDisplayComponents(
			new TextDisplayBuilder().setContent(content)
		);
		const msg = await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		if (msg && deleteAfterMs > 0) {
			setTimeout(() => msg.delete().catch(() => undefined), deleteAfterMs).unref();
		}
		return msg;
	}

	/** Parse duration string to seconds. Returns null if invalid. */
	private parseDuration(input: string, channelName: string): number | null {
		const trimmed = input.trim().toLowerCase();
		// Handle "disable" or "off"
		if (trimmed === "disable" || trimmed === "off") {
			console.log(`[Slowmode] Disabling slowmode in ${channelName}`);
			return 0;
		}
		// Handle plain numbers
		if (/^\d+$/.test(trimmed)) {
			const value = parseInt(trimmed, 10);
			if (value >= 1 && value <= 21_600) {
				console.log(`[Slowmode] Setting slowmode to ${value}s in ${channelName}`);
				return value;
			}
		}
		// Handle suffixes: s, m, h
		const match = trimmed.match(/^(\d+)([smh])$/);
		if (!match) return null;
		const value = parseInt(match[1]!, 10);
		const unit = match[2]!;
		switch (unit) {
			case "s": return value;
			case "m": return value * 60;
			case "h": return value * 3_600;
			default:
				return null;
		}
	}

	public constructor() {
		super({
			name: "slowmode",
			description: {
				content: "Set, view, or disable slowmode for the current channel",
				examples: ["slowmode 10", "slowmode 5m", "slowmode 1h", "slowmode disable"],
				usage: "slowmode <duration | disable>",
			},
			category: "moderation",
			slashCommand: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "ManageChannels"],
				user: ["ManageChannels"],
			},
			options: [
				{
					name: "duration",
					description: "Duration (e.g., 10, 5m, 1h) or 'disable' to turn off slowmode",
					type: ApplicationCommandOptionType.String,
					required: false,
				},
				{
					name: "reason",
					description: "Reason for changing slowmode",
					type: ApplicationCommandOptionType.String,
					required: false,
					max_length: 500,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// --- Environment Checks ---
		if (!("setRateLimitPerUser" in ctx.channel)) {
			return this.sendError(ctx, "Slowmode is not supported in this channel");
		}
		if (!(ctx.channel instanceof TextChannel)) {
			return this.sendError(ctx, "This command can only be used in text channels");
		}

		// --- Argument Parsing ---
		// For prefix commands, args[0] is the first argument after the command
		// For slash commands, getString("duration") gets the option value
		const durationStr = ctx.options.getString("duration", false, 0) ?? "";
		const reason = ctx.options.getString("reason", false, 1) ?? "No reason provided";

		console.log(`[Slowmode] durationStr: "${durationStr}", isInteraction: ${ctx.isInteraction}`);
		// No arguments provided → Show help
		if (!durationStr.trim()) {
			return new Help().showCommand(ctx, "slowmode");
		}

		// Parse duration before permission checks
		const seconds = this.parseDuration(durationStr, ctx.channel.name);
		if (seconds === null) {
			console.error("[Slowmode] Invalid duration format:", durationStr);
			return this.sendError(ctx, "Choose a valid duration (e.g., `10`, `5m`, `1h`) or `disable` to turn off slowmode.");
		}

		// --- Permission Checks ---
		if (!ctx.author || !ctx.channel.permissionsFor(ctx.author)?.has("ManageChannels")) {
			return this.sendError(ctx, "You need the `Manage Channels` permission to change slowmode.");
		}

		// --- Check if slowmode is enabled when trying to disable ---
		if (seconds === 0) {
			const currentRateLimit = ctx.channel.rateLimitPerUser || 0;
			if (currentRateLimit === 0) {
				return this.sendError(ctx, "Slowmode is not currently enabled in this channel.");
			}
		}

		// --- Apply Slowmode ---
		try {
			await ctx.channel.setRateLimitPerUser(seconds, reason);
			console.log(`[Slowmode] Successfully set slowmode to ${seconds}s in ${ctx.channel.name}`);

			const action = seconds === 0 ? "disabled" : `set to **${seconds}s**`;
			return this.sendSuccess(ctx, `Slowmode has been ${action}.`);
		} catch (error) {
			console.error("[Slowmode] Error:", error);
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			return this.sendError(ctx, `Failed to set slowmode: ${errorMessage}`);
		}
	}
}
