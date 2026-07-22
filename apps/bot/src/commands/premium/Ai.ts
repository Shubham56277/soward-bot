import {
	ApplicationCommandOptionType,
	ContainerBuilder,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import type { AiAnswer, AiRequestResult, AiScope } from "../../service/aiService";

export default class Ai extends Command {
	public constructor() {
		super({
			name: "ai",
			description: {
				content: "Ask the premium AI assistant or manage conversation mode",
				usage: "ai <ask|start|stop|status|reset> [question]",
				examples: ["ai ask Explain Redis", "ai start", "ai stop"],
			},
			premium: true,
			cooldown: 2,
			slashCommand: true,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "ReadMessageHistory"],
				user: [],
			},
			options: [
				{
					name: "ask",
					description: "Ask the AI assistant a question",
					type: ApplicationCommandOptionType.Subcommand,
					options: [{
						name: "question",
						description: "What would you like to ask?",
						type: ApplicationCommandOptionType.String,
						required: true,
						max_length: 4_000,
					}],
				},
				{ name: "start", description: "Start an AI conversation in this channel", type: ApplicationCommandOptionType.Subcommand },
				{ name: "stop", description: "Stop your AI conversation in this channel", type: ApplicationCommandOptionType.Subcommand },
				{ name: "status", description: "Show AI availability and session status", type: ApplicationCommandOptionType.Subcommand },
				{ name: "reset", description: "Clear your AI conversation history", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const action = (ctx.options.getSubCommand(false, 0) ?? "status").toLowerCase();
		const scope = this.scope(ctx);

		if (action === "start") {
			await ctx.client.ai.startSession(scope);
			return this.sendNotice(ctx, "AI Conversation Started", "Messages you send in this channel will use your private AI session. Use `/ai stop` when finished.");
		}
		if (action === "stop") {
			await ctx.client.ai.stopSession(scope);
			return this.sendNotice(ctx, "AI Conversation Stopped", "The session and its temporary conversation history were removed.");
		}
		if (action === "reset") {
			await ctx.client.ai.resetHistory(scope);
			return this.sendNotice(ctx, "AI History Cleared", "Your temporary conversation context for this channel was removed.");
		}
		if (action === "status") {
			const [active, providers] = await Promise.all([
				ctx.client.ai.isSessionActive(scope),
				Promise.resolve(ctx.client.ai.configuredProviders()),
			]);
			return this.sendNotice(
				ctx,
				"Premium AI",
				`**Session** ${active ? "Active" : "Stopped"}\n**Providers ready** ${providers.length}\n-# **Ask once with \`/ai ask\`, or use \`/ai start\` for a conversation.**`,
			);
		}

		if (action !== "ask") return this.sendNotice(ctx, "Premium AI", "Use `/ai ask`, `/ai start`, `/ai stop`, `/ai status`, or `/ai reset`.");
		const question = ctx.isInteraction ? ctx.options.getString("question", true) : ctx.args.slice(1).join(" ");
		if (!question?.trim()) return this.sendNotice(ctx, "Question Required", "Add a question after the command.");
		const active = await ctx.client.ai.isSessionActive(scope);
		const result = await ctx.client.ai.ask(scope, question, active);
		return this.sendResult(ctx, result);
	}

	private scope(ctx: Context): AiScope {
		return { guildId: ctx.guild.id, channelId: ctx.channelId, userId: ctx.author!.id };
	}

	private async sendResult(ctx: Context, result: AiRequestResult): Promise<any> {
		if (!result.ok) {
			const messages = {
				busy: "Another AI request is already running. Try again in a moment.",
				rate_limited: `The AI request limit was reached. Try again in ${result.retryAfter ?? 60} seconds.`,
				not_configured: "No AI provider is configured yet. The bot owner must add at least one API key.",
				unavailable: "Every configured AI provider is temporarily unavailable. Try again shortly.",
			};
			return this.sendNotice(ctx, "AI Unavailable", messages[result.reason]);
		}
		return ctx.sendMessage({ components: [this.answerView(ctx, result.answer)], flags: MessageFlags.IsComponentsV2 });
	}

	private answerView(ctx: Context, answer: AiAnswer): ContainerBuilder {
		const container = new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent("## AI Answer\n-# **A private premium response.**"))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
		for (const part of splitText(answer.text, 3_500)) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(part));
		}
		return container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# **${answer.provider} · ${answer.model} · ${answer.cached ? "Redis cache" : `${(answer.latencyMs / 1_000).toFixed(2)}s`}**`),
		);
	}

	private sendNotice(ctx: Context, title: string, description: string): Promise<any> {
		const view = new ContainerBuilder()
			.setAccentColor(ctx.client.config.colors.main)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
		return ctx.sendMessage({ components: [view], flags: MessageFlags.IsComponentsV2 });
	}
}

function splitText(text: string, maxLength: number): string[] {
	const result: string[] = [];
	let remaining = text.trim();
	while (remaining.length > maxLength) {
		let index = remaining.lastIndexOf("\n", maxLength);
		if (index < maxLength / 2) index = remaining.lastIndexOf(" ", maxLength);
		if (index < maxLength / 2) index = maxLength;
		result.push(remaining.slice(0, index).trim());
		remaining = remaining.slice(index).trim();
	}
	if (remaining) result.push(remaining);
	return result;
}
