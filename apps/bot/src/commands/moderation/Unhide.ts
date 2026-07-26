import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType, ChannelType, GuildChannel, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Unhide extends Command {
	constructor() {
		super({
			name: "unhide",
			description: {
				content: "Unhide a channel from @everyone",
				examples: ["unhide #general", "unhide 123456789012345678"],
				usage: "unhide [channel]",
			},
			category: "moderation",
			aliases: ["unhidechannel"],
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
					description: "The channel to unhide",
					type: ApplicationCommandOptionType.Channel,
					required: false,
				},
				{
					name: "role",
					description: "Specific role to unhide for (defaults to @everyone)",
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
		const channel: GuildChannel = (ctx.options?.getChannel("channel", false) as GuildChannel) || ctx.channel;
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		if (![ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type)) {
			return await ctx.sendMessage(this.msg("This command only works for text and voice channels"));
		}

		try {
			await channel.permissionOverwrites.edit(
				role as Role,
				{
					ViewChannel: null, // Resets to default
				},
				{ reason: `Unhidden by ${ctx.author?.tag}` },
			);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Channel Unhidden**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Channel:** #${channel.name}\n` +
					`**Unhidden For:** ${role.name}\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}`
				));

			await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("Unhide Error:", error);
			await ctx.sendMessage(this.msg("Failed to unhide channel"));
		}
	}
}
