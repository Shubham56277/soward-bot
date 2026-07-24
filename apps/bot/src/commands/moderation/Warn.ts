import { ApplicationCommandOptionType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";
import * as reply from "../../utils/reply";

export default class Warn extends Command {
	constructor() {
		super({
			name: "warn",
			description: {
				content: "Warn a member",
				examples: ["warn @user Breaking rules"],
				usage: "warn <user> [reason]",
			},
			category: "moderation",
			cooldown: 5,
			args: true,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ModerateMembers"],
			},
			slashCommand: true,
			options: [
				{
					name: "add",
					description: "Warn a user",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "The user to warn",
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: "reason",
							description: "Reason for the warning",
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: "list",
					description: "List warnings for a user",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "The user to check",
							type: ApplicationCommandOptionType.User,
							required: true,
						},
					],
				},
				{
					name: "remove",
					description: "Remove a warning",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "warning_id",
							description: "The ID of the warning to remove",
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: "clear",
					description: "Clear all warnings for a user",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "The user to clear warnings for",
							type: ApplicationCommandOptionType.User,
							required: true,
						},
					],
				},
			],
		});
	}

	public run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand();

		switch (subcommand) {
			case "add":
				return this.handleAdd(ctx, true);
			case "list":
				return this.handleList(ctx);
			case "remove":
				return this.handleRemove(ctx);
			case "clear":
				return this.handleClear(ctx);
			default:
				return this.handleAdd(ctx);
		}
	}

	private async handleAdd(ctx: Context, isSubcommand = false) {
		if (!ctx.guild || !ctx.author) return;

		const target = ctx.options.getMember("user", isSubcommand ? 1 : 0) as GuildMember | null;
		const reason = ctx.isInteraction
			? ctx.options.getString("reason", false) || "No reason provided"
			: ctx.args.slice(isSubcommand ? 2 : 1).join(" ") || "No reason provided";

		if (!target) return this.sendError(ctx, "User not found");
		if (target.id === ctx.author.id) return this.sendError(ctx, "You cannot warn yourself");
		if (target.id === ctx.client.user?.id) return this.sendError(ctx, "I cannot warn myself");

		try {
			const warning = await Warning.create({
				guildId: ctx.guild.id,
				userId: target.id,
				moderatorId: ctx.author.id,
				reason,
			});

			if (!warning) return this.sendError(ctx, "Failed to create warning");

			const warningsCount = await Warning.getUserWarningCount(ctx.guild.id, target.id);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**⚠️ User Warned**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**User:** ${target.toString()}\n` +
					`**Moderator:** ${ctx.author.toString()}\n` +
					`**Reason:** ${reason}\n` +
					`**Total Warnings:** ${warningsCount}`
				))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Warning ID: ${warning.id}`));

			// DM the warned user (use embed for DM since it's a different context)
			await target.send({
				embeds: [{
					color: 0x000000,
					title: "⚠️ You have been warned",
					description: `**Server:** ${ctx.guild.name}\n**Reason:** ${reason}\n**Moderator:** ${ctx.author.toString()}\n**Warning ID:** \`${warning.id}\``,
				}]
			}).catch(() => {});

			return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("Warn Error:", error);
			return this.sendError(ctx, "An error occurred while warning this user");
		}
	}

	private async handleList(ctx: Context) {
		if (!ctx.guild) return;

		const target = ctx.options.getMember("user", 1) as GuildMember | null;

		if (!target) return this.sendError(ctx, "User not found");

		const warnings = await Warning.getUserWarnings(ctx.guild.id, target.id);
		const warningsCount = warnings.length;

		if (warningsCount === 0) {
			return reply.info(ctx, `${target.toString()} has no warnings`);
		}

		const formattedWarnings = warnings.map((warn, index) =>
			`**#${index + 1}** - \`${warn.id}\`\n` +
			`> **Reason:** ${warn.reason}\n` +
			`> **Moderator:** <@${warn.moderatorId}>\n` +
			`> **Date:** <t:${Math.floor(warn.createdAt.getTime() / 1000)}:R>`
		).join("\n\n");

		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${target.user.tag}'s Warnings (${warningsCount})**`))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(formattedWarnings))
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# User ID: ${target.id}`));

		return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
	}

	private async handleRemove(ctx: Context) {
		if (!ctx.guild) return;

		const warningId = ctx.isInteraction ? ctx.options.getString("warning_id", true) : ctx.args[1];

		if (!warningId) return this.sendError(ctx, "Please provide a warning ID");

		try {
			const warning = await Warning.getById(warningId);

			if (!warning || warning.guildId !== ctx.guild.id) {
				return this.sendError(ctx, "Warning not found");
			}

			await Warning.delete(warningId);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`<:Tick:1375519268292264012> Successfully removed warning \`${warningId}\``
				));

			return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("Remove Warning Error:", error);
			return this.sendError(ctx, "Failed to remove warning");
		}
	}

	private async handleClear(ctx: Context) {
		if (!ctx.guild || !ctx.author) return;

		const target = ctx.options.getMember("user", 1) as GuildMember | null;

		if (!target) return this.sendError(ctx, "User not found");

		try {
			const countBefore = await Warning.getUserWarningCount(ctx.guild.id, target.id);

			if (countBefore === 0) {
				return this.sendError(ctx, "This user has no warnings to clear");
			}

			await Warning.deleteAllUserWarnings(ctx.guild.id, target.id);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`<:Tick:1375519268292264012> Cleared **${countBefore}** warning${countBefore !== 1 ? "s" : ""} for ${target.toString()}`
				));

			return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("Clear Warnings Error:", error);
			return this.sendError(ctx, "Failed to clear warnings");
		}
	}

	private async sendError(ctx: Context, message: string) {
		return reply.error(ctx, message);
	}
}
