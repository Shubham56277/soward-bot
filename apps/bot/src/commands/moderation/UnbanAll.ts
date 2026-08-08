import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function buildPanel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class UnbanAll extends Command {
	constructor() {
		super({
			name: "unbanall",
			description: {
				content: "Mass unban all banned users with rate limiting",
				examples: ["unbanall", 'unbanall --reason="Clean slate"'],
				usage: "unbanall [reason]",
			},
			category: "moderation",
			aliases: ["massunban"],
			cooldown: 60, // Prevent spam
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["BanMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["BanMembers"],
			},
            slashCommand: false,
			options: [
				{
					name: "reason",
					description: "Reason for the unban",
					type: ApplicationCommandOptionType.String,
					required: false,
				},
				{
					name: "limit",
					description: "Maximum number of unbans to process (default: 100)",
					type: ApplicationCommandOptionType.Integer,
					required: false,
					max_value: 1,
					min_value: 1000,
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
		// Get reason
		let reason = ctx.options.getString("reason", false, 0) || `Mass unban by ${ctx.author?.tag}`;
		const limit = ctx.options.getInteger("limit", false, 1) || 100;

		// Handle text command arguments
		if (!ctx.isInteraction) {
			if (ctx.args.length > 0) {
				reason = ctx.args.join(" ");
			}
		}

		// Confirm action
		const confirmContainer = buildPanel(
			"Confirm Mass Unban",
			`This will unban up to ${limit} users. Are you sure you want to proceed?\n\n**Reason:** ${reason}`,
		);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("confirm_unban").setLabel("Confirm").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("cancel_unban").setLabel("Cancel").setStyle(ButtonStyle.Danger),
		);

		const confirmMessage = await ctx.sendMessage({
			components: [confirmContainer, actionRow],
			flags: MessageFlags.IsComponentsV2,
		});

		// Wait for confirmation
		try {
			const confirmation = await confirmMessage.awaitMessageComponent({
				filter: (i) => i.user.id === ctx.author?.id,
				time: 30000,
			});

			if (confirmation.customId === "cancel_unban") {
				await confirmation.update({
					components: [buildPanel("Cancelled", "Mass unban cancelled")],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			await confirmation.update({
				components: [buildPanel("Processing", "Processing unbans...")],
				flags: MessageFlags.IsComponentsV2,
			});
		} catch (_error) {
			// Interaction timed out
			await confirmMessage.edit({
				components: [buildPanel("Timed Out", "Confirmation timed out")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		try {
			// Get banned users
			const bans = await ctx.guild.bans.fetch({ limit });
			const bannedUsers = Array.from(bans.values());
			const totalBans = bannedUsers.length;

			if (totalBans === 0) {
				return await ctx.sendMessage(this.msg("No users are currently banned"));
			}

			// Initialize progress panel
			let progressBody = `Unbanning ${totalBans} users...\n\n**Progress:** 0/${totalBans} (0%)\n**Estimated Time:** Calculating...\n**Reason:** ${reason}`;

			const progressMessage = await ctx.sendMessage({
				components: [buildPanel("Processing Mass Unban", progressBody)],
				flags: MessageFlags.IsComponentsV2,
			});

			// Rate limiting variables
			const startTime = Date.now();
			let processed = 0;
			const rateLimit = 5; // Number of unbans per interval
			const interval = 1000; // 1 second interval

			// Process unbans with rate limiting
			for (let i = 0; i < bannedUsers.length; i += rateLimit) {
				const batch = bannedUsers.slice(i, i + rateLimit);
				const promises = batch.map((ban) =>
					ctx.guild.members
						.unban(ban.user.id, reason)
						.then(() => {
							processed++;
							// Update progress every 10% or so
							if (processed % Math.max(1, Math.floor(totalBans / 10)) === 0 || processed === totalBans) {

								const remaining = Math.ceil((totalBans - processed) / rateLimit);
								const percentage = Math.round((processed / totalBans) * 100);

								progressBody = `Unbanning ${totalBans} users...\n\n**Progress:** ${processed}/${totalBans} (${percentage}%)\n**Estimated Time:** ${remaining} seconds remaining\n**Reason:** ${reason}`;

								progressMessage.edit({
									components: [buildPanel("Processing Mass Unban", progressBody)],
									flags: MessageFlags.IsComponentsV2,
								}).catch(console.error);
							}
						})
						.catch((error) => {
							console.error(`Failed to unban ${ban.user.id}:`, error);
							// Continue with next even if one fails
						}),
				);

				await Promise.all(promises);

				// Rate limit delay between batches
				if (i + rateLimit < bannedUsers.length) {
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}

			// Final result
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const resultContainer = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Mass Unban Complete**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`Successfully unbanned ${processed} users\n\n` +
					`**Total Time:** ${elapsed} seconds\n` +
					`**Reason:** ${reason}`
				));

			await progressMessage.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
		} catch (error) {
			console.error("UnbanAll Error:", error);
			await ctx.sendMessage(this.msg("An error occurred while processing the mass unban"));
		}
	}
}
