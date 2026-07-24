import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AntiNukeService } from '../../services/security/antiNukeService';
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from 'discord.js';

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

function cv2(title: string, body: string) {
	return { components: [buildPanel(title, body)], flags: MessageFlags.IsComponentsV2 };
}

export default class SecurityCommand extends Command {
	constructor() {
		super({
			name: 'security',
			description: {
				content: 'Security and AntiNuke commands',
				usage: 'security <subcommand>',
				examples: ['security antinuke enable', 'security trust add @user'],
			},
			category: 'security',
			subcommands: [
				{
					name: 'antinuke',
					description: 'AntiNuke configuration',
					type: ApplicationCommandOptionType.SubcommandGroup,
					subcommands: [
						{
							name: 'enable',
							description: 'Enable AntiNuke protection',
							type: ApplicationCommandOptionType.Subcommand,
						},
						{
							name: 'disable',
							description: 'Disable AntiNuke protection',
							type: ApplicationCommandOptionType.Subcommand,
						},
						{
							name: 'status',
							description: 'View AntiNuke status',
							type: ApplicationCommandOptionType.Subcommand,
						},
						{
							name: 'config',
							description: 'View AntiNuke configuration',
							type: ApplicationCommandOptionType.Subcommand,
						},
					],
				},
				{
					name: 'trust',
					description: 'Manage trusted users',
					type: ApplicationCommandOptionType.SubcommandGroup,
					subcommands: [
						{
							name: 'add',
							description: 'Add a trusted user',
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: 'user',
									description: 'The user to trust',
									type: ApplicationCommandOptionType.User,
									required: true,
								},
								{
									name: 'scope',
									description: 'Trust scope',
									type: ApplicationCommandOptionType.String,
									required: false,
									choices: [
										{ name: 'Global', value: 'global' },
										{ name: 'AntiNuke', value: 'antinuke' },
										{ name: 'AutoMod', value: 'automod' },
									],
								},
							],
						},
						{
							name: 'remove',
							description: 'Remove a trusted user',
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: 'user',
									description: 'The user to remove',
									type: ApplicationCommandOptionType.User,
									required: true,
								},
							],
						},
						{
							name: 'list',
							description: 'List all trusted users',
							type: ApplicationCommandOptionType.Subcommand,
						},
					],
				},
				{
					name: 'panic',
					description: 'Panic mode commands',
					type: ApplicationCommandOptionType.SubcommandGroup,
					subcommands: [
						{
							name: 'enable',
							description: 'Enable panic mode',
							type: ApplicationCommandOptionType.Subcommand,
						},
						{
							name: 'disable',
							description: 'Disable panic mode',
							type: ApplicationCommandOptionType.Subcommand,
						},
						{
							name: 'status',
							description: 'View panic mode status',
							type: ApplicationCommandOptionType.Subcommand,
						},
					],
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const group = ctx.options.getSubcommandGroup();
		const subcommand = ctx.options.getSubCommand();

		switch (group) {
			case 'antinuke':
				await this.handleAntinuke(ctx, subcommand);
				break;
			case 'trust':
				await this.handleTrust(ctx, subcommand);
				break;
			case 'panic':
				await this.handlePanic(ctx, subcommand);
				break;
			default:
				await ctx.sendMessage({ content: 'Invalid command' });
		}
	}

	private async handleAntinuke(ctx: Context, action: string): Promise<void> {
		switch (action) {
			case 'enable': {
				await AntiNukeService.setEnabled(ctx.guild!.id, true);
				await ctx.sendMessage(cv2('🛡️ AntiNuke Enabled', 'AntiNuke protection is now active for this server.'));
				break;
			}
			case 'disable': {
				await AntiNukeService.setEnabled(ctx.guild!.id, false);
				await ctx.sendMessage(cv2('⚠️ AntiNuke Disabled', 'AntiNuke protection has been disabled.'));
				break;
			}
			case 'status': {
				const enabled = await AntiNukeService.isEnabled(ctx.guild!.id);
				await ctx.sendMessage(cv2('🛡️ AntiNuke Status', `AntiNuke is currently **${enabled ? 'enabled' : 'disabled'}**.`));
				break;
			}
			case 'config': {
				const config = await AntiNukeService.getConfig(ctx.guild!.id);
				await ctx.sendMessage(cv2(
					'🛡️ AntiNuke Configuration',
					`**Status:** ${config?.enabled ? 'Enabled' : 'Disabled'}\u2003\u2003**Trusted Users:** ${config?.trustedUsers?.length?.toString() || '0'}`
				));
				break;
			}
		}
	}

	private async handleTrust(ctx: Context, action: string): Promise<void> {
		switch (action) {
			case 'add': {
				const user = ctx.options.getUser('user');
				if (!user) {
					await ctx.sendMessage({ content: 'Please specify a user to trust' });
					return;
				}

				await AntiNukeService.addTrustedUser(ctx.guild!.id, user.id);
				await ctx.sendMessage(cv2('✅ User Trusted', `${user.tag} has been added to the trusted users list.`));
				break;
			}
			case 'remove': {
				const user = ctx.options.getUser('user');
				if (!user) {
					await ctx.sendMessage({ content: 'Please specify a user to remove' });
					return;
				}

				await AntiNukeService.removeTrustedUser(ctx.guild!.id, user.id);
				await ctx.sendMessage(cv2('✅ User Removed', `${user.tag} has been removed from the trusted users list.`));
				break;
			}
			case 'list': {
				const config = await AntiNukeService.getConfig(ctx.guild!.id);
				const trusted = config?.trustedUsers || [];

				if (trusted.length === 0) {
					await ctx.sendMessage({ content: 'No trusted users configured' });
					return;
				}

				await ctx.sendMessage(cv2('🛡️ Trusted Users', trusted.map((id: string) => `<@${id}>`).join('\n')));
				break;
			}
		}
	}

	private async handlePanic(ctx: Context, _action: string): Promise<void> {
		// Placeholder for panic mode implementation
		await ctx.sendMessage({
			content: '⚠️ Panic mode features coming soon in premium tier',
		});
	}
}
