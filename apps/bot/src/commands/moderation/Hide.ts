import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType, ChannelType, GuildChannel, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Hide extends Command {
	constructor() {
		super({
			name: "hide",
			description: {
				content: "Hide a channel from @everyone",
				examples: ["hide #secret-channel", "hide 123456789012345678"],
				usage: "hide [channel]",
			},
			category: "moderation",
			aliases: ["hidechannel"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["ManageChannels", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ManageChannels"],
			},
			slashCommand: true,
			options: [
				{
					name: "channel",
					description: "The channel to hide",
					type: ApplicationCommandOptionType.Channel,
					required: false,
				},
				{
					name: "role",
					description: "Specific role to hide from (defaults to @everyone)",
					type: ApplicationCommandOptionType.Role,
					required: false,
				},
			],
		});
	}

	private msg(text: string): any {
		return {
			components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
			flags: MessageFlags.IsComponentsV2,
		};
	}

	public async run(ctx: Context): Promise<any> {
		const channel: GuildChannel = ctx.options?.getChannel("channel", false) as GuildChannel || ctx.channel;
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		if (![ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type)) {
			return await ctx.sendMessage(this.msg("This command only works for text and voice channels"));
		}

		try {
			await channel.permissionOverwrites.edit(
				role as Role,
				{
					ViewChannel: false,
				},
				{ reason: `Hidden by ${ctx.author?.tag}` },
			);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Channel Hidden**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Channel:** #${channel.name}\n` +
					`**Hidden From:** ${role.name}\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}`
				));

			await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("Hide Error:", error);
			await ctx.sendMessage(this.msg("Failed to hide channel"));
		}
	}
}
