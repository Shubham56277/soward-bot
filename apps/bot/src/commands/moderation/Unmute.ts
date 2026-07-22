import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Unmute extends Command {
    constructor() {
        super({
            name: "unmute",
            description: {
                content: "Remove timeout restrictions from a member",
                examples: [
                    "unmute @user",
                    "unmute 123456789012345678"
                ],
                usage: "unmute <user> [reason]",
            },
            category: "moderation",
            aliases: ["untimeout", "removemute"],
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
                    description: "The member to unmute",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the unmute",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user",) as GuildMember | null;
        let reason = ctx.options.getString("reason", false) || "No reason provided";

        // Handle text command arguments
        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        // Validate target
        if (!target) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Member not found");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Check if member is actually muted
        if (!target.isCommunicationDisabled()) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setDescription("This member is not currently muted");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        try {
            // Remove timeout
            await target.timeout(null, reason).catch(() => { });
            // Create response embed
            const unmuteEmbed = new EmbedBuilder()
                .setColor(Colors.Green)
                .setTitle("🔈 Member Unmuted")
                .setThumbnail(target.displayAvatarURL())
                .setDescription(
                    `**User:** ${target.toString()}\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setFooter({ text: `ID: ${target.id}` })
                .setTimestamp();

            return await ctx.sendMessage({ embeds: [unmuteEmbed] });

        } catch (error) {
            console.error("Unmute Error:", error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("An error occurred while trying to unmute this member");
            return await ctx.sendMessage({ embeds: [embed] });
        }
    }
}