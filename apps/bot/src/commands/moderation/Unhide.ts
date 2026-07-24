import { EmbedBuilder, ApplicationCommandOptionType, ChannelType, GuildChannel, Role } from "discord.js";
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

	public async run(ctx: Context): Promise<any> {
		const channel: GuildChannel = (ctx.options?.getChannel("channel", false) as GuildChannel) || ctx.channel;
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		if (![ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type)) {
			const embed = new EmbedBuilder().setColor(0x000000).setDescription("This command only works for text and voice channels");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		try {
			await channel.permissionOverwrites.edit(
				role as Role,
				{
					ViewChannel: null, // Resets to default
				},
				{ reason: `Unhidden by ${ctx.author?.tag}` },
			);

			const embed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("👁️ Channel Unhidden")
				.setDescription(
					`**Channel:** ${channel.toString()}\n` +
					`**Unhidden For:** ${role.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
				);

			await ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("Unhide Error:", error);
			const embed = new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> Failed to unhide channel");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
