import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import ms from "@lukeed/ms";

export default class Timeout extends Command {
    constructor() {
        super({
            name: "timeout",
            description: {
                content: "Restrict a member's ability to interact with the server",
                examples: [
                    "timeout @user 30m Disruptive behavior",
                    "timeout 123456789012345678 2h Spamming"
                ],
                usage: "timeout <user> <duration> [reason]",
            },
            category: "moderation",
            aliases: ["mute", "silence"],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["ModerateMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
                user: ["ModerateMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The member to timeout",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "duration",
                    description: "Timeout duration (e.g., 30m, 2h, 1d)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the timeout",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "silent",
                    description: "Whether to notify the user about the timeout",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const durationInput = ctx.options.getString("duration", true, 1)

        // Convert duration to milliseconds
        const duration = ms.parse(durationInput ?? "5minute");
        let reason = ctx.options.getString("reason", false, 2) || "No reason provided";

        // Handle text command arguments
        if (!ctx.isInteraction) {
            const args = ctx.args;
            if (args.length < 2) {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setDescription("Please specify both a user and duration");
                return await ctx.sendMessage({ embeds: [embed] });
            }
            reason = args.slice(2).join(" ") || "No reason provided";
        }

        // Validate target
        if (!target) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Member not found");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Validate duration
        if (!duration || Number.isNaN(duration)) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Invalid duration format. Use examples like 30m, 2h, 1d");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        const minDuration = 10_000; // 10 seconds
        const maxDuration = 28 * 24 * 60 * 60 * 1000; // 28 days

        if (duration < minDuration || duration > maxDuration) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Duration must be between 10 seconds and 28 days");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Validation checks
        if (target.id === ctx.author?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot timeout yourself");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (target.id === ctx.client.user?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot timeout me");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (target.id === ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot timeout the server owner");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (target.roles.highest.position >= (ctx.member?.roles.highest.position ?? 0) && ctx.author?.id !== ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot timeout someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("I cannot timeout someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Execute the timeout
        await target.timeout(duration, reason);

        // Create response embed
        const timeoutEmbed = new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle("⏳ Member Timed Out")
            .setThumbnail(target.displayAvatarURL())
            .setDescription(
                `**User:** ${target.toString()}\n` +
                `**Duration:** ${durationInput}\n` +
                `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                `**Reason:** ${reason}`
            )
            .setFooter({ text: `ID: ${target.id}` })
            .setTimestamp();
        return await ctx.sendMessage({ embeds: [timeoutEmbed] });
    }
}
