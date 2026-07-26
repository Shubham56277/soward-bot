import { ApplicationCommandOptionType, GuildMember, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Mute extends Command {
	public constructor() {
		super({
			name: "mute",
			description: {
				content: "Temporarily mute a server member",
				examples: ["mute @user 10", "mute @user 60 Spamming in chat"],
				usage: "mute <user> [minutes] [reason]",
			},
			category: "moderation",
			aliases: ["timeout", "silence"],
			cooldown: 5,
			args: true,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["ModerateMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
				user: ["ModerateMembers"],
			},
			slashCommand: true,
			options: [
				{ name: "user", description: "Member to mute", type: ApplicationCommandOptionType.User, required: true },
				// Duration string with suffix: s (seconds), m (minutes), h (hours), d (days)
				{ name: "duration", description: "Duration (e.g., 10m, 1h, 30s). Default: 10m", type: ApplicationCommandOptionType.String, required: false },
				{ name: "reason", description: "Reason for the mute", type: ApplicationCommandOptionType.String, required: false, max_length: 500 },
				{ name: "silent", description: "Whether to notify the user about the mute", type: ApplicationCommandOptionType.Boolean, required: false },
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
		const member = ctx.options.getMember("user", 0) as GuildMember | null;
		const targetUser = ctx.options.getUser("user", true);

		if (!targetUser || !member) {
			return await ctx.sendMessage(this.msg("User not found."));
		}

		if (member.id === ctx.author?.id) {
			return await ctx.sendMessage(this.msg("You cannot mute yourself."));
		}

		if (member.id === ctx.client.user?.id) {
			return await ctx.sendMessage(this.msg("You cannot mute me."));
		}

		if (member.id === ctx.guild.ownerId) {
			return await ctx.sendMessage(this.msg("You cannot mute the server owner."));
		}

		if (!member.moderatable) {
			return await ctx.sendMessage(this.msg("I cannot mute that member because their role is above mine."));
		}

		const moderatorPosition = ctx.member instanceof GuildMember ? ctx.member.roles.highest.position : 0;
		if (ctx.author?.id !== ctx.guild.ownerId && member.roles.highest.position >= moderatorPosition) {
			return await ctx.sendMessage(this.msg("You cannot mute someone with a higher or equal role."));
		}

		// Parse duration string with suffix (e.g., "10m", "30s", "2h").
		const durationStr = ctx.options.getString("duration", false, 1) ?? "10m"; // default to 10 minutes
		const silent = ctx.options.getBoolean("silent", false, 3) ?? false;

		let reason = ctx.options.getString("reason", false, 2) ?? "No reason provided";

		// Helper to parse duration string into seconds.
		const parseDuration = (input: string): number | null => {
			const match = input.trim().match(/^(\d+)([smhd])$/i);
			if (!match) return null;
			const value = parseInt(match[1], 10);
			const unit = match[2].toLowerCase();
			switch (unit) {
				case "s": return value;
				case "m": return value * 60;
				case "h": return value * 3600;
				case "d": return value * 86400;
				default: return null;
			}
		};

		const durationSeconds = parseDuration(durationStr);
		if (durationSeconds === null) {
			return await ctx.sendMessage(this.msg("Invalid duration format. Use e.g., `10m`, `30s`, `2h`."));
		}
		const durationMs = durationSeconds * 1000;
		if (!ctx.isInteraction) {
			const args = ctx.args.slice(2);
			if (args.length > 0) reason = args.join(" ");
		}

		try {
			// Notify user if not silent
			if (!silent) {
				try {
					const dmEmbed = new EmbedBuilder()
						.setColor(0x000000)
						.setTitle(`You've been muted in ${ctx.guild.name}`)
						.setDescription(`**Reason:** ${reason}\n**Duration:** ${durationStr}\n**Moderator:** ${ctx.author?.username || "Unknown"}`)
						.setTimestamp();
					await targetUser.send({ embeds: [dmEmbed] });
				} catch {
					// DMs are closed, continue anyway
				}
			}

			// Use previously calculated durationMs.
			await member.timeout(durationMs, reason);

			const container = new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Member Muted**`))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(
					`**User:** ${targetUser.username}\n` +
					`**Moderator:** ${ctx.author?.username || "Unknown"}\n` +
					`**Duration:** ${durationStr}\n` +
					`**Reason:** ${reason}`
				))
				.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${member.id}`));

			const msg = await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
			setTimeout(() => msg?.delete?.().catch(() => {}), 4_000);
			return msg;
		} catch (error) {
			console.error("Mute Error:", error);
			return await ctx.sendMessage(this.msg("An error occurred while trying to mute this user."));
		}
	}
}
