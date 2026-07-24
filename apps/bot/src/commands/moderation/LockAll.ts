import { EmbedBuilder, ChannelType, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class LockAll extends Command {
	constructor() {
		super({
			name: "lockall",
			description: {
				content: "Lock all text channels",
				examples: ["lockall"],
				usage: "lockall",
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
					description: "Reason for locking",
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
			.setColor(0x000000)
			.setTitle("⚠️ Confirm Mass Lock")
			.setDescription("This will lock ALL text channels in the server.")
			.addFields(
				{ name: "Moderator", value: ctx.author?.toString() || "Unknown" },
			);

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
							customId: "confirm_lockall",
						},
						{
							type: 2,
							style: 4,
							label: "Cancel",
							customId: "cancel_lockall",
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

			if (confirmation.customId === "cancel_lockall") {
				await confirmation.update({
					embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Tick:1375519268292264012> Operation cancelled")],
					components: [],
				});
				return;
			}

			await confirmation.update({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("⏳ Processing...")],
				components: [],
			});
		} catch (_error) {
			await confirmMessage.edit({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> Confirmation timed out")],
				components: [],
			});
			return;
		}

		try {
			const channels = ctx.guild.channels.cache.filter(
				(c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice || c.type === ChannelType.GuildAnnouncement,
			);
			if (channels.size === 0) {
				const embed = new EmbedBuilder().setColor(0x000000).setDescription("No channels found to lock");
				return await ctx.sendMessage({ embeds: [embed] });
			}

			const progressEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("🔒 Locking All Channels")
				.setDescription(`Processing ${channels.size} channels...`)
				.addFields({ name: "Progress", value: `0/${channels.size} (0%)` }, { name: "Reason", value: reason });

			const progressMessage = await ctx.sendMessage({ embeds: [progressEmbed] });


			const startTime = Date.now();
			let processed = 0;
			const rateLimit = 5;
			const interval = 1000;

			for (const channel of channels.values()) {
				try {
					await channel.permissionOverwrites.edit(
						ctx.guild.roles.everyone,
						{
							SendMessages: false,
						},
						{ reason: `Mass lock by ${ctx.author?.tag}` },
					);
					processed++;

					if (processed % Math.max(1, Math.floor(channels.size / 10)) === 0 || processed === channels.size) {
						const percentage = Math.round((processed / channels.size) * 100);

						progressEmbed.spliceFields(0, 1, { name: "Progress", value: `${processed}/${channels.size} (${percentage}%)` });

						progressMessage.edit({ embeds: [progressEmbed] }).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to lock ${channel.id}:`, error);
				}

				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("<:Tick:1375519268292264012> Mass Lock Complete")
				.setDescription(`Successfully locked ${processed} channels`)
				.addFields({ name: "Total Time", value: `${elapsed} seconds` }, { name: "Moderator", value: ctx.author?.toString() || "Unknown" });

			await progressMessage.edit({ embeds: [resultEmbed] });
		} catch (error) {
			console.error("LockAll Error:", error);
			const embed = new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> An error occurred during mass lock");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
