import { EmbedBuilder, ChannelType, ApplicationCommandOptionType, Role, Collection, GuildChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class UnhideAll extends Command {
	constructor() {
		super({
			name: "unhideall",
			description: {
				content: "Unhide all channels for @everyone or a specific role",
				examples: ["unhideall", "unhideall role:@Members"],
				usage: "unhideall [role]",
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
					description: "Specific role to unhide for (defaults to @everyone)",
					type: ApplicationCommandOptionType.Role,
					required: false,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		// Confirmation
		const confirmEmbed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle("⚠️ Confirm Mass Unhide")
			.setDescription(`This will unhide ALL channels for ${role.toString()}.`)
			.addFields({ name: "Moderator", value: ctx.author?.toString() || "Unknown" });

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
							customId: "confirm_unhideall",
						},
						{
							type: 2,
							style: 4,
							label: "Cancel",
							customId: "cancel_unhideall",
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

			if (confirmation.customId === "cancel_unhideall") {
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
		} catch {
			await confirmMessage.edit({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> Confirmation timed out")],
				components: [],
			});
			return;
		}

		try {
			const channels = ctx.guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildAnnouncement].includes(c.type)) as Collection<string, GuildChannel>;
			
			if (channels.size === 0) {
				return await ctx.sendMessage({
					embeds: [new EmbedBuilder().setColor(0x000000).setDescription("No channels found to unhide")],
				});
			}

			const progressEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("👁️ Unhiding All Channels")
				.setDescription(`Processing ${channels.size} channels...`)
				.addFields({ name: "Progress", value: `0/${channels.size} (0%)` }, { name: "Unhidden For", value: role.toString() });

			const progressMessage = await ctx.sendMessage({ embeds: [progressEmbed] });

			let processed = 0;
			const startTime = Date.now();
			const rateLimit = 5;
			const interval = 1000;

			for (const channel of channels.filter((c) => c.manageable).values()) {
				try {
					await channel.permissionOverwrites.edit(
						role as Role,
						{
							ViewChannel: true,
						},
						{ reason: `Mass unhide by ${ctx.author?.tag}` },
					);

					processed++;

					if (processed % Math.max(1, Math.floor(channels.size / 10)) === 0 || processed === channels.size) {
						const percentage = Math.round((processed / channels.size) * 100);
						progressEmbed.spliceFields(0, 1, {
							name: "Progress",
							value: `${processed}/${channels.size} (${percentage}%)`,
						});
						progressMessage.edit({ embeds: [progressEmbed] }).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to unhide ${channel.id}:`, error);
				}

				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("<:Tick:1375519268292264012> Mass Unhide Complete")
				.setDescription(`Successfully unhided ${processed} channels for ${role.toString()}`)
				.addFields({ name: "Total Time", value: `${elapsed} seconds` }, { name: "Moderator", value: ctx.author?.toString() || "Unknown" });

			await progressMessage.edit({ embeds: [resultEmbed] });
		} catch (error) {
			console.error("UnhideAll Error:", error);
			await ctx.sendMessage({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> An error occurred during mass unhide")],
			});
		}
	}
}
