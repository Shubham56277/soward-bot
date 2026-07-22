import { EmbedBuilder, Colors, ChannelType, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class UnlockAll extends Command {
	constructor() {
		super({
			name: "unlockall",
			description: {
				content: "Unlock all text channels",
				examples: ["unlockall"],
				usage: "unlockall",
			},
			category: "moderation",
			cooldown: 60,
			args: false,
			permissions: {
				dev: false,
				client: ["ManageChannels", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ManageChannels", "Administrator"],
			},
            slashCommand: false,
			options: [
				{
					name: "reason",
					description: "Reason for unlocking",
					type: ApplicationCommandOptionType.String,
					required: false,
				}
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const reason = ctx.options?.getString("reason", false) || "No reason provided";

		// Confirmation
		const confirmEmbed = new EmbedBuilder()
			.setColor(Colors.Yellow)
			.setTitle("⚠️ Confirm Mass Unlock")
			.setDescription("This will unlock ALL text channels in the server.")
			.addFields(
				{ name: "Moderator", value: ctx.author?.toString() || "Unknown" },
			)

		const confirmMessage = await ctx.sendMessage({
			embeds: [confirmEmbed],
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 3,
							label: "Confirm",
							customId: "confirm_unlockall",
						},
						{
							type: 2,
							style: 4,
							label: "Cancel",
							customId: "cancel_unlockall",
						},
					],
				},
			],
		});

		try {
			const confirmation = await confirmMessage.awaitMessageComponent({
				filter: (i) => i.user.id === ctx.author?.id,
				time: 30000,
			});

			if (confirmation.customId === "cancel_unlockall") {
				await confirmation.update({
					embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription("<:Tick:1375519268292264012> Operation cancelled")],
					components: [],
				});
				return;
			}

			await confirmation.update({
				embeds: [new EmbedBuilder().setColor(Colors.Blue).setDescription("⏳ Processing...")],
				components: [],
			});
		} catch (_error) {
			await confirmMessage.edit({
				embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> Confirmation timed out")],
				components: [],
			});
			return;
		}

		try {
			const channels = ctx.guild.channels.cache.filter(
				(c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice || c.type === ChannelType.GuildAnnouncement,
			);

			if (channels.size === 0) {
				const embed = new EmbedBuilder().setColor(Colors.Yellow).setDescription("No channels found to unlock");
				return await ctx.sendMessage({ embeds: [embed] });
			}

			const progressEmbed = new EmbedBuilder()
				.setColor(Colors.Blue)
				.setTitle("🔓 Unlocking All Channels")
				.setDescription(`Processing ${channels.size} channels...`)
				.addFields({ name: "Progress", value: `0/${channels.size} (0%)` }, { name: "Reason", value: reason });

			const progressMessage = await ctx.sendMessage({ embeds: [progressEmbed] });

			const startTime = Date.now();
			let processed = 0;
			const rateLimit = 5; // Channels per second
			const interval = 1000; // 1 second

			for (const channel of channels.values()) {
				try {
					await channel.permissionOverwrites.edit(
						ctx.guild.roles.everyone,
						{
							SendMessages: null, // Reset to default
						},
						{ reason: `Mass unlock by ${ctx.author?.tag}` },
					);

					processed++;

					if (processed % Math.max(1, Math.floor(channels.size / 10)) === 0 || processed === channels.size) {
						const percentage = Math.round((processed / channels.size) * 100);

						progressEmbed.spliceFields(0, 1, { name: "Progress", value: `${processed}/${channels.size} (${percentage}%)` });

						progressMessage.edit({ embeds: [progressEmbed] }).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to unlock ${channel.id}:`, error);
				}

				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultEmbed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle("<:Tick:1375519268292264012> Mass Unlock Complete")
				.setDescription(`Successfully unlocked ${processed} channels`)
				.addFields({ name: "Total Time", value: `${elapsed} seconds` }, { name: "Moderator", value: ctx.author?.toString() || "Unknown" });

			await progressMessage.edit({ embeds: [resultEmbed] });
		} catch (error) {
			console.error("UnlockAll Error:", error);
			const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> An error occurred during mass unlock");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
