import { EmbedBuilder, ApplicationCommandOptionType, Colors, ChannelType, GuildChannel, TextChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

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
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("This command only works for text channels");
			return await ctx.sendMessage({ embeds: [embed] });
		}

		try {
			await channel.permissionOverwrites.edit(
				ctx.guild.roles.everyone,
				{
					SendMessages: null, // Reset to default
				},
				{ reason },
			);
			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle("🔓 Channel Unlocked")
				.setDescription(
					`**Channel:** ${channel.toString()}\n` +
					`**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
					`**Reason:** ${reason}`
				);

			await ctx.sendMessage({ embeds: [embed] });

			if (channel.id !== ctx.channel.id) {
				const unlockNotice = new EmbedBuilder().setColor(Colors.Green).setTitle("🔓 Channel Unlocked").setDescription(`This channel has been unlocked by a moderator.\n**Reason:** ${reason}`);

				if (channel instanceof TextChannel) await channel.send({ embeds: [unlockNotice] });
			}
		} catch (error) {
			console.error("Unlock Error:", error);
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Failed to unlock channel");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}