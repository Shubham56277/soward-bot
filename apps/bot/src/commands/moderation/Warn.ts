import { ApplicationCommandOptionType, Colors, EmbedBuilder, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

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

		const reason = ctx.isInteraction ? ctx.options.getString("reason", false) || "No reason provided" : ctx.args.slice(isSubcommand ? 2 : 1).join(" ") || "No reason provided";

		if (!target) {
			return this.sendError(ctx, "User not found");
		}

		if (target.id === ctx.author.id) {
			return this.sendError(ctx, "You cannot warn yourself");
		}

		if (target.id === ctx.client.user?.id) {
			return this.sendError(ctx, "I cannot warn myself");
		}

		try {
			const warning = await Warning.create({
				guildId: ctx.guild.id,
				userId: target.id,
				moderatorId: ctx.author.id,
				reason: reason,
			});

			if (!warning) {
				return this.sendError(ctx, "Failed to create warning");
			}

			const warningsCount = await Warning.getUserWarningCount(ctx.guild.id, target.id);

			const embed = new EmbedBuilder()
				.setColor(Colors.Orange)
				.setTitle("⚠️ User Warned")
				.setThumbnail(target.displayAvatarURL())
				.setDescription(
					`**User:** ${target.toString()}\n` +
					`**Moderator:** ${ctx.author.toString()}\n` +
					`**Reason:** ${reason}\n` +
					`**Total Warnings:** ${warningsCount}`
				)
				.setFooter({ text: `Warning ID: ${warning.id}` });

			await target.send({ embeds: [embed] }).catch(() => { });
			return ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("Warn Error:", error);
			return this.sendError(ctx, "An error occurred while warning this user");
		}
	}
	private async handleList(ctx: Context) {
		if (!ctx.guild) return;

		const target = ctx.options.getMember("user", 1) as GuildMember | null;

		if (!target) {
			return this.sendError(ctx, "User not found");
		}

		const warnings = await Warning.getUserWarnings(ctx.guild.id, target.id);
		const warningsCount = warnings.length;

		if (warningsCount === 0) {
			return ctx.sendMessage({
				embeds: [new EmbedBuilder().setColor(Colors.Blue).setDescription(`${target.toString()} has no warnings`)],
			});
		}

		const formattedWarnings = warnings.map((warn, index) => {
			return (
				`**#${index + 1}** - \`${warn.id}\`\n` + `> **Reason:** ${warn.reason}\n` + `> **Moderator:** <@${warn.moderatorId}>\n` + `> **Date:** <t:${Math.floor(warn.createdAt.getTime() / 1000)}:R>\n`
			);
		});

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle(`${target.user.tag}'s Warnings (${warningsCount})`)
			.setDescription(formattedWarnings.join("\n"))
			.setThumbnail(target.displayAvatarURL())
			.setFooter({ text: `User ID: ${target.id}` });

		return ctx.sendMessage({ embeds: [embed] });
	}

	private async handleRemove(ctx: Context) {
		if (!ctx.guild) return;

		const warningId = ctx.isInteraction ? ctx.options.getString("warning_id", true) : ctx.args[1];

		if (!warningId) {
			return this.sendError(ctx, "Please provide a warning ID");
		}

		try {
			const warning = await Warning.getById(warningId);

			if (!warning || warning.guildId !== ctx.guild.id) {
				return this.sendError(ctx, "Warning not found");
			}

			await Warning.delete(warningId);

			return ctx.sendMessage({
				embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`<:Tick:1375519268292264012> Successfully removed warning \`${warningId}\``)],
			});
		} catch (error) {
			console.error("Remove Warning Error:", error);
			return this.sendError(ctx, "Failed to remove warning");
		}
	}
	private async handleClear(ctx: Context) {
		if (!ctx.guild || !ctx.author) return;

		const target = ctx.options.getMember("user", 1) as GuildMember | null;

		if (!target) {
			return this.sendError(ctx, "User not found");
		}

		try {
			const countBefore = await Warning.getUserWarningCount(ctx.guild.id, target.id);

			if (countBefore === 0) {
				return this.sendError(ctx, "This user has no warnings to clear");
			}

			await Warning.deleteAllUserWarnings(ctx.guild.id, target.id);

			return ctx.sendMessage({
				embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`<:Tick:1375519268292264012> Cleared ${countBefore} warnings for ${target.toString()}`)],
			});
		} catch (error) {
			console.error("Clear Warnings Error:", error);
			return this.sendError(ctx, "Failed to clear warnings");
		}
	}
	private async showHelp(ctx: Context) {
		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("Warn Command Help")
			.setDescription(
				"**Subcommands:**\n" +
				"`/warn add <user> [reason]` - Warn a user\n" +
				"`/warn list <user>` - List user's warnings\n" +
				"`/warn remove <warning_id>` - Remove a warning\n" +
				"`/warn clear <user>` - Clear all warnings for a user",
			);

		return ctx.sendMessage({ embeds: [embed] });
	}
	private async sendError(ctx: Context, message: string) {
		return ctx.sendMessage({
			embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`<:Cross:1375519752746958858> ${message}`)],
		});
	}
}
