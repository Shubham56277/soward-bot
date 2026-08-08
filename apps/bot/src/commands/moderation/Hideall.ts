import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ChannelType, ApplicationCommandOptionType, Role, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

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

	private msg(text: string): any {
		return {
			components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
			flags: MessageFlags.IsComponentsV2,
		};
	}

	public async run(ctx: Context): Promise<any> {
		const role = ctx.options?.getRole("role", false) || ctx.guild.roles.everyone;

		// Confirmation
		const confirmContainer = buildPanel(
			"Confirm Mass Hide",
			`This will hide ALL channels from ${role.name}.\n\n**Moderator:** ${ctx.author?.username || "Unknown"}`,
		);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_hideall").setLabel("Confirm").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("cancel_hideall").setLabel("Cancel").setStyle(ButtonStyle.Danger),
		);

		const confirmMessage = await ctx.sendMessage({
			components: [confirmContainer, actionRow],
			flags: MessageFlags.IsComponentsV2,
		});

		try {
			const confirmation = await confirmMessage.awaitMessageComponent({
				filter: (i) => i.user.id === ctx.author?.id,
				time: 30000,
			});

			if (confirmation.customId === "cancel_hideall") {
				await confirmation.update({
					components: [buildPanel("Cancelled", "Operation cancelled")],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			await confirmation.update({
				components: [buildPanel("Processing", "Processing...")],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch (_error) {
			await confirmMessage.edit({
				components: [buildPanel("Timed Out", "Confirmation timed out")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		try {
			const channels = ctx.guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice || c.type === ChannelType.GuildAnnouncement);

			if (channels.size === 0) {
				return await ctx.sendMessage(this.msg("No channels found to hide"));
			}

			// Progress panel
			let progressBody = `Processing ${channels.size} channels...\n\n**Progress:** 0/${channels.size} (0%)\n**Hidden From:** ${role.name}`;

			const progressMessage = await ctx.sendMessage({
				components: [buildPanel("Hiding All Channels", progressBody)],
				flags: MessageFlags.IsComponentsV2,
			});

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

						progressBody = `Processing ${channels.size} channels...\n\n**Progress:** ${processed}/${channels.size} (${percentage}%)\n**Hidden From:** ${role.name}`;

						progressMessage.edit({
							components: [buildPanel("Hiding All Channels", progressBody)],
							flags: MessageFlags.IsComponentsV2,
						}).catch(console.error);
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
			const resultContainer = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Mass Hide Complete**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`Successfully hide ${processed} channels from ${role.name}\n\n` +
					`**Total Time:** ${elapsed} seconds\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}`
				));

			await progressMessage.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("HideAll Error:", error);
			await ctx.sendMessage(this.msg("An error occurred during mass hide"));
		}
	}
}
