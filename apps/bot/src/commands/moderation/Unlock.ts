import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType, ChannelType, GuildChannel, TextChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import * as reply from "../../utils/reply";

export default class Unlock extends Command {
	constructor() {
		super({
			name: "unlock",
			description: {
				content: "Unlock a channel",
				examples: ["unlock #general", "unlock 123456789012345678"],
				usage: "unlock [channel]",
			},
			category: "moderation",
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
					description: "The channel to unlock",
					type: ApplicationCommandOptionType.Channel,
					required: false,
				},
				{
					name: "reason",
					description: "Reason for unlocking",
					type: ApplicationCommandOptionType.String,
					required: false,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const channel: GuildChannel = ctx.options?.getChannel("channel", false) as GuildChannel || ctx.channel;
		const reason = ctx.options?.getString("reason", false) || "No reason provided";

		if (channel.type !== ChannelType.GuildText) {
			return reply.error(ctx, "This command only works for text channels");
		}

		try {
			await channel.permissionOverwrites.edit(
				ctx.guild.roles.everyone,
				{
					SendMessages: null, // Reset to default
				},
				{ reason },
			);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🔓 Channel Unlocked**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**Channel:** ${channel.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
					`**Reason:** ${reason}`
				));

			await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

			if (channel.id !== ctx.channel.id) {
				const noticeContainer = new ContainerBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(
						`**🔓 Channel Unlocked**\nThis channel has been unlocked by a moderator.\n**Reason:** ${reason}`
					));

				if (channel instanceof TextChannel) {
					await channel.send({ components: [noticeContainer], flags: MessageFlags.IsComponentsV2 });
				}
			}
		} catch (error) {
			console.error("Unlock Error:", error);
			return reply.error(ctx, "Failed to unlock channel");
		}
	}
}
