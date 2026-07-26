import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ChannelType, ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

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

	private msg(text: string): any {
		return {
			components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
			flags: MessageFlags.IsComponentsV2,
		};
	}

	public async run(ctx: Context): Promise<any> {
		const reason = ctx.options?.getString("reason", false) || "No reason provided";

		// Confirmation
		const confirmContainer = buildPanel(
			"Confirm Mass Unlock",
			`This will unlock ALL text channels in the server.\n\n**Moderator:** ${ctx.author?.username || "Unknown"}`,
		);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_unlockall").setLabel("Confirm").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("cancel_unlockall").setLabel("Cancel").setStyle(ButtonStyle.Danger),
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

			if (confirmation.customId === "cancel_unlockall") {
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
			const channels = ctx.guild.channels.cache.filter(
				(c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice || c.type === ChannelType.GuildAnnouncement,
			);

			if (channels.size === 0) {
				return await ctx.sendMessage(this.msg("No channels found to unlock"));
			}

			let progressBody = `Processing ${channels.size} channels...\n\n**Progress:** 0/${channels.size} (0%)\n**Reason:** ${reason}`;

			const progressMessage = await ctx.sendMessage({
				components: [buildPanel("Unlocking All Channels", progressBody)],
				flags: MessageFlags.IsComponentsV2,
			});

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

						progressBody = `Processing ${channels.size} channels...\n\n**Progress:** ${processed}/${channels.size} (${percentage}%)\n**Reason:** ${reason}`;

						progressMessage.edit({
							components: [buildPanel("Unlocking All Channels", progressBody)],
							flags: MessageFlags.IsComponentsV2,
						}).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to unlock ${channel.id}:`, error);
				}

				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultContainer = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Mass Unlock Complete**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`Successfully unlocked ${processed} channels\n\n` +
					`**Total Time:** ${elapsed} seconds\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}`
				));

			await progressMessage.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("UnlockAll Error:", error);
			await ctx.sendMessage(this.msg("An error occurred during mass unlock"));
		}
	}
}
