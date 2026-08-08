import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ChannelType, ApplicationCommandOptionType, Role, Collection, GuildChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

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
			"Confirm Mass Unhide",
			`This will unhide ALL channels for ${role.name}.\n\n**Moderator:** ${ctx.author?.username || "Unknown"}`,
		);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_unhideall").setLabel("Confirm").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("cancel_unhideall").setLabel("Cancel").setStyle(ButtonStyle.Danger),
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

			if (confirmation.customId === "cancel_unhideall") {
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
		} catch {
			await confirmMessage.edit({
				components: [buildPanel("Timed Out", "Confirmation timed out")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		try {
			const channels = ctx.guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildAnnouncement].includes(c.type)) as Collection<string, GuildChannel>;

			if (channels.size === 0) {
				return await ctx.sendMessage(this.msg("No channels found to unhide"));
			}

			let progressBody = `Processing ${channels.size} channels...\n\n**Progress:** 0/${channels.size} (0%)\n**Unhidden For:** ${role.name}`;

			const progressMessage = await ctx.sendMessage({
				components: [buildPanel("Unhiding All Channels", progressBody)],
				flags: MessageFlags.IsComponentsV2,
			});

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
						progressBody = `Processing ${channels.size} channels...\n\n**Progress:** ${processed}/${channels.size} (${percentage}%)\n**Unhidden For:** ${role.name}`;
						progressMessage.edit({
							components: [buildPanel("Unhiding All Channels", progressBody)],
							flags: MessageFlags.IsComponentsV2,
						}).catch(console.error);
					}
				} catch (error) {
					console.error(`Failed to unhide ${channel.id}:`, error);
				}

				if (processed % rateLimit === 0 && processed !== channels.size) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultContainer = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Mass Unhide Complete**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`Successfully unhided ${processed} channels for ${role.name}\n\n` +
					`**Total Time:** ${elapsed} seconds\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}`
				));

			await progressMessage.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("UnhideAll Error:", error);
			await ctx.sendMessage(this.msg("An error occurred during mass unhide"));
		}
	}
}
