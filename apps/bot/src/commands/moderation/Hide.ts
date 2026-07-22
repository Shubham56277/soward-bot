import { EmbedBuilder, ApplicationCommandOptionType, Colors, ChannelType, GuildChannel, Role } from "discord.js";
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

	public async run(ctx: Context): Promise<any> {
		const channel: GuildChannel = ctx.options?.getChannel("channel", false) as GuildChannel || ctx.channel;
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		if (![ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type)) {
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("This command only works for text and voice channels");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		try {
			await channel.permissionOverwrites.edit(
				role as Role,
				{
					ViewChannel: false,
				},
				{ reason: `Hidden by ${ctx.author?.tag}` },
			);

			const embed = new EmbedBuilder()
				.setColor(Colors.Red)
				.setTitle("👁️ Channel Hidden")
				.setDescription(
					`**Channel:** ${channel.toString()}\n` +
					`**Hidden From:** ${role.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}`
				);

			await ctx.sendMessage({ embeds: [embed] });
		} catch (error) {
			console.error("Hide Error:", error);
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Failed to hide channel");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}