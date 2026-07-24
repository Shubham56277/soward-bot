import { EmbedBuilder, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

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
		const confirmEmbed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle("⚠️ Confirm Mass Unban")
			.setDescription(`This will unban up to ${limit} users. Are you sure you want to proceed?`)
			.addFields({ name: "Reason", value: reason });

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
							customId: "confirm_unban",
						},
						{
							type: 2,
							style: 4,
							label: "Cancel",
							customId: "cancel_unban",
						},
					],
				},
			],
		});

		// Wait for confirmation
		try {
			const confirmation = await confirmMessage.awaitMessageComponent({
				filter: (i) => i.user.id === ctx.author?.id,
				time: 30000,
			});

			if (confirmation.customId === "cancel_unban") {
				await confirmation.update({
					embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Tick:1375519268292264012> Mass unban cancelled")],
					components: [],
				});
				return;
			}

			await confirmation.update({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("⏳ Processing unbans...")],
				components: [],
			});
		} catch (_error) {
			// Interaction timed out
			await confirmMessage.edit({
				embeds: [new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> Confirmation timed out")],
				components: [],
			});
			return;
		}

		try {
			// Get banned users
			const bans = await ctx.guild.bans.fetch({ limit });
			const bannedUsers = Array.from(bans.values());
			const totalBans = bannedUsers.length;

			if (totalBans === 0) {
				const embed = new EmbedBuilder().setColor(0x000000).setDescription("<:Tick:1375519268292264012> No users are currently banned");
				return await ctx.sendMessage({ embeds: [embed] });
			}

			// Initialize progress embed
			const progressEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("🔓 Processing Mass Unban")
				.setDescription(`Unbanning ${totalBans} users...`)
				.addFields({ name: "Progress", value: `0/${totalBans} (0%)` }, { name: "Estimated Time", value: "Calculating..." }, { name: "Reason", value: reason });

			const progressMessage = await ctx.sendMessage({ embeds: [progressEmbed] });

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

								progressEmbed.spliceFields(0, 2, { name: "Progress", value: `${processed}/${totalBans} (${percentage}%)` }, { name: "Estimated Time", value: `${remaining} seconds remaining` });

								progressMessage.edit({ embeds: [progressEmbed] }).catch(console.error);
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
			const resultEmbed = new EmbedBuilder()
				.setColor(0x000000)
				.setTitle("<:Tick:1375519268292264012> Mass Unban Complete")
				.setDescription(`Successfully unbanned ${processed} users`)
				.addFields({ name: "Total Time", value: `${elapsed} seconds` }, { name: "Reason", value: reason });

			await progressMessage.edit({ embeds: [resultEmbed] });
		} catch (error) {
			console.error("UnbanAll Error:", error);
			const embed = new EmbedBuilder().setColor(0x000000).setDescription("<:Cross:1375519752746958858> An error occurred while processing the mass unban");
			await ctx.sendMessage({ embeds: [embed] });
		}
	}
}
