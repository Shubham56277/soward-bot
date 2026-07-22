import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ModerationService } from '../../services/moderation/moderationService';
import { EmbedBuilder, ApplicationCommandOptionType } from 'discord.js';

export default class BanCommand extends Command {
	constructor() {
		super({
			name: 'moderation',
			description: 'Moderation commands',
			category: 'moderation',
			permissions: ['BanMembers'],
			subcommands: [
				{
					name: 'ban',
					description: 'Ban a member from the server',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The user to ban',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'reason',
							description: 'Reason for the ban',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
						{
							name: 'delete-days',
							description: 'Days of messages to delete (0-7)',
							type: ApplicationCommandOptionType.Integer,
							required: false,
							minValue: 0,
							maxValue: 7,
						},
					],
				},
				{
					name: 'kick',
					description: 'Kick a member from the server',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The member to kick',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'reason',
							description: 'Reason for the kick',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: 'timeout',
					description: 'Timeout a member',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The member to timeout',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'duration',
							description: 'Duration in minutes',
							type: ApplicationCommandOptionType.Integer,
							required: true,
							minValue: 1,
							maxValue: 40320, // 28 days in minutes
						},
						{
							name: 'reason',
							description: 'Reason for the timeout',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: 'warn',
					description: 'Warn a member',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The member to warn',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'reason',
							description: 'Reason for the warning',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: 'softban',
					description: 'Softban a member (ban and unban to purge messages)',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The user to softban',
							type: ApplicationCommandOptionType.User,
							required: true,
						},
						{
							name: 'reason',
							description: 'Reason for the softban',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: 'unban',
					description: 'Unban a user',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The user ID to unban',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
						{
							name: 'reason',
							description: 'Reason for the unban',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
				{
					name: 'history',
					description: 'View moderation history for a user',
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: 'user',
							description: 'The user to view history for',
							type: ApplicationCommandOptionType.User,
							required: false,
						},
						{
							name: 'case-id',
							description: 'View a specific case by ID',
							type: ApplicationCommandOptionType.Integer,
							required: false,
						},
						{
							name: 'limit',
							description: 'Number of cases to show (default: 10)',
							type: ApplicationCommandOptionType.Integer,
							required: false,
							minValue: 1,
							maxValue: 25,
						},
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.options.getSubCommand();

		switch (subcommand) {
			case 'ban':
				await this.handleBan(ctx);
				break;
			case 'kick':
				await this.handleKick(ctx);
				break;
			case 'timeout':
				await this.handleTimeout(ctx);
				break;
			case 'warn':
				await this.handleWarn(ctx);
				break;
			case 'softban':
				await this.handleSoftban(ctx);
				break;
			case 'unban':
				await this.handleUnban(ctx);
				break;
			case 'history':
				await this.handleHistory(ctx);
				break;
			default:
				await ctx.sendMessage({ content: 'Invalid subcommand' });
		}
	}

	private async handleBan(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const reason = ctx.options.getString('reason') || 'No reason provided';
		const deleteDays = ctx.options.getInteger('delete-days') || 1;

		if (!user) {
			await ctx.sendMessage({ content: 'Please specify a user to ban' });
			return;
		}

		const result = await ModerationService.ban(ctx.member!, user, reason, deleteDays);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('🔨 Member Banned')
			.setColor('Red')
			.addFields(
				{ name: 'User', value: `${user.tag} (${user.id})`, inline: true },
				{ name: 'Moderator', value: `${ctx.author.tag}`, inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleKick(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const reason = ctx.options.getString('reason') || 'No reason provided';

		if (!user) {
			await ctx.sendMessage({ content: 'Please specify a member to kick' });
			return;
		}

		const member = ctx.guild?.members.cache.get(user.id);
		if (!member) {
			await ctx.sendMessage({ content: 'Member not found in this server' });
			return;
		}

		const result = await ModerationService.kick(ctx.member!, member, reason);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('👢 Member Kicked')
			.setColor('Orange')
			.addFields(
				{ name: 'User', value: `${user.tag} (${user.id})`, inline: true },
				{ name: 'Moderator', value: `${ctx.author.tag}`, inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleTimeout(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const duration = ctx.options.getInteger('duration')!;
		const reason = ctx.options.getString('reason') || 'No reason provided';

		if (!user) {
			await ctx.sendMessage({ content: 'Please specify a member to timeout' });
			return;
		}

		const member = ctx.guild?.members.cache.get(user.id);
		if (!member) {
			await ctx.sendMessage({ content: 'Member not found in this server' });
			return;
		}

		const durationMs = duration * 60 * 1000;
		const result = await ModerationService.timeout(ctx.member!, member, durationMs, reason);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('⏱️ Member Timed Out')
			.setColor('Yellow')
			.addFields(
				{ name: 'User', value: `${user.tag} (${user.id})`, inline: true },
				{ name: 'Duration', value: this.formatDuration(duration), inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleWarn(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const reason = ctx.options.getString('reason') || 'No reason provided';

		if (!user) {
			await ctx.sendMessage({ content: 'Please specify a member to warn' });
			return;
		}

		const member = ctx.guild?.members.cache.get(user.id);
		if (!member) {
			await ctx.sendMessage({ content: 'Member not found in this server' });
			return;
		}

		const result = await ModerationService.warn(ctx.member!, member, reason);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('⚠️ Member Warned')
			.setColor('Yellow')
			.addFields(
				{ name: 'User', value: `${user.tag} (${user.id})`, inline: true },
				{ name: 'Moderator', value: `${ctx.author.tag}`, inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleSoftban(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const reason = ctx.options.getString('reason') || 'No reason provided';

		if (!user) {
			await ctx.sendMessage({ content: 'Please specify a user to softban' });
			return;
		}

		const result = await ModerationService.softban(ctx.member!, user, reason);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('🔨 Member Softbanned')
			.setColor('Purple')
			.setDescription('User has been banned and immediately unbanned to purge their messages.')
			.addFields(
				{ name: 'User', value: `${user.tag} (${user.id})`, inline: true },
				{ name: 'Moderator', value: `${ctx.author.tag}`, inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleUnban(ctx: Context): Promise<void> {
		const userId = ctx.options.getString('user');
		const reason = ctx.options.getString('reason') || 'No reason provided';

		if (!userId) {
			await ctx.sendMessage({ content: 'Please provide a user ID to unban' });
			return;
		}

		const result = await ModerationService.unban(ctx.member!, userId, reason);

		if (!result.success) {
			await ctx.sendMessage({ content: `❌ ${result.error}` });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle('✅ User Unbanned')
			.setColor('Green')
			.addFields(
				{ name: 'User ID', value: userId, inline: true },
				{ name: 'Moderator', value: `${ctx.author.tag}`, inline: true },
				{ name: 'Case ID', value: `#${result.caseId}`, inline: true },
				{ name: 'Reason', value: reason },
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private async handleHistory(ctx: Context): Promise<void> {
		const user = ctx.options.getUser('user');
		const caseId = ctx.options.getInteger('case-id');
		const limit = ctx.options.getInteger('limit') || 10;

		const { ModerationCaseService } = await import('../../services/moderation/moderationCaseService');

		if (caseId) {
			const case_ = await ModerationCaseService.getCase(ctx.guild!.id, caseId);
			if (!case_) {
				await ctx.sendMessage({ content: `Case #${caseId} not found` });
				return;
			}

			const embed = new EmbedBuilder()
				.setTitle(`Case #${caseId}`)
				.setColor('Blue')
				.addFields(
					{ name: 'User', value: `<@${case_.targetId}>`, inline: true },
					{ name: 'Moderator', value: `<@${case_.moderatorId}>`, inline: true },
					{ name: 'Action', value: case_.action.toUpperCase(), inline: true },
					{ name: 'Reason', value: case_.reason },
				)
				.setTimestamp(case_.createdAt);

			await ctx.sendMessage({ embeds: [embed] });
			return;
		}

		const targetId = user?.id || ctx.author.id;
		const cases = await ModerationCaseService.getUserCases(ctx.guild!.id, targetId, limit);

		if (cases.length === 0) {
			await ctx.sendMessage({ content: 'No moderation history found' });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle(`Moderation History for ${user?.tag || ctx.author.tag}`)
			.setColor('Blue')
			.setDescription(
				cases.map(c => `**#${c.caseId}** - ${c.action.toUpperCase()} - ${c.reason}`).join('\n')
			)
			.setTimestamp();

		await ctx.sendMessage({ embeds: [embed] });
	}

	private formatDuration(minutes: number): string {
		if (minutes < 60) return `${minutes} minutes`;
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours < 24) return `${hours}h ${mins}m`;
		const days = Math.floor(hours / 24);
		const hrs = hours % 24;
		return `${days}d ${hrs}h ${mins}m`;
	}
}
