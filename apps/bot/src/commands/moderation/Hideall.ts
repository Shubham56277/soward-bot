import { EmbedBuilder, ChannelType, ApplicationCommandOptionType, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class HideAll extends Command {
	constructor() {
		super({
			name: "hideall",
			description: {
				content: "Hide all channels from @everyone",
				examples: ["hideall"],
				usage: "hideall",
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
					name: "role",
					description: "Specific role to hide from (defaults to @everyone)",
					type: ApplicationCommandOptionType.Role,
					required: false,
				}
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		// Confirmation
		const confirmEmbed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle("⚠️ Confirm Mass Hide")
			.setDescription(`This will hide ALL channels from ${role.toString()}.`)
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
							customId: "confirm_hideall",
						},
						{
							type: 2,
							style: 4,
							label: "Cancel",
							customId: "cancel_hideall",
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

			if (confirmation.customId === "cancel_hideall") {
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
			const channels = ctx.guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice || c.type === ChannelType.GuildAnnouncement);

			if (channels.size === 0) {
				const embed = new EmbedBuilder().setColor(0x000000).setDescription("No channels found to hide");
				return await ctx.sendMessage({ embeds: [embed] });
			}

			// Progress embed
			const progressEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("👁️ Hiding All Channels")
				.setDescription(`Processing ${channels.size} channels...`)
				.addFields({ name: "Progress", value: `0/${channels.size} (0%)` }, { name: "Hidden From", value: role.toString() });

			const progressMessage = await ctx.sendMessage({ embeds: [progressEmbed] });

			// Process with rate limiting
			const startTime = Date.now();
			let processed = 0;
			const rateLimit = 5; // Channels per second
			const interval = 1000; // 1 second

			for (const channel of channels.values()) {
				try {
					await channel.permissionOverwrites.edit(
						role as Role,
						{
							ViewChannel: false,
						},
						{ reason: `Mass hide by ${ctx.author?.tag}` },
					);

					processed++;

					// Update progress every 10% or when complete
					if (processed % Math.max(1, Math.floor(channels.size / 10)) === 0 || processed === channels.size) {
						const percentage = Math.round((processed / channels.size) * 100);

						progressEmbed.spliceFields(0, 1, { name: "Progress", value: `${processed}/${channels.size} (${percentage}%)` });

						progressMessage.edit({ embeds: [progressEmbed] }).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to hide ${channel.id}:`, error);
				}

				// Rate limit delay
				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			// Final result
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("<:Tick:1375519268292264012> Mass Hide Complete")
				.setDescription(`Successfully hide ${processed} channels from ${role.toString()}`)
				.addFields({ name: "Total Time", value: `${elapsed} seconds` }, { name: "Moderator", value: ctx.author?.toString() || "Unknown" });

			await progressMessage.edit({ embeds: [resultEmbed] });
		} catch (error) {
			console.error("HideAll Error:", error);
			const embed = new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> An error occurred during mass hide");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
