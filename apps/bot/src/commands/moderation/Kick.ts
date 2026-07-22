import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Kick extends Command {
    constructor() {
        super({
            name: "kick",
            description: {
                content: "Remove a user from the server",
                examples: [
                    "kick @user Disruptive behavior",
                    "kick 123456789012345678 Spamming"
                ],
                usage: "kick <user> [reason]",
            },
            category: "moderation",
            aliases: ["remove", "eject"],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["KickMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
                user: ["KickMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to remove from the server",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the removal",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "silent",
                    description: "Whether to notify the user about the kick",
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        // Get target user
        const target = ctx.options.getMember("user") as GuildMember | null;
        const targetUser = ctx.options.getUser("user", true);
        const silent = ctx.options.getBoolean("silent", false, 1) ?? false;

        // Handle user not found
        if (!targetUser) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("User not found");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Get reason
        let reason = ctx.options.getString("reason") || "No reason provided";

        // Handle text command arguments
        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        // Validation checks
        if (targetUser.id === ctx.author?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot kick yourself");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (targetUser.id === ctx.client.user?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot kick me");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (targetUser.id === ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot kick the server owner");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        const moderatorPosition = ctx.member?.roles.highest.position ?? 0;
        if (target && target.roles.highest.position >= moderatorPosition && ctx.author?.id !== ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot kick someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (target && ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("I cannot kick someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        try {
            // Notify user if not silent
            if (!silent && target) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(Colors.Orange)
                        .setTitle(`You've been removed from ${ctx.guild.name}`)
                        .setDescription(
                            `**Reason:** ${reason}\n` +
                            `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}`
                        )
                        .setTimestamp();

                    await target.send({ embeds: [dmEmbed] });
                } catch {
                    // User has DMs closed, we'll continue anyway
                }
            }

            // Execute the kick
            await ctx.guild.members.kick(targetUser, reason);

            // Create audit log embed
            const kickEmbed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setTitle("👢 Member Removed")
                .setThumbnail(targetUser.displayAvatarURL())
                .setDescription(
                    `**User:** ${targetUser.toString()}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setFooter({ text: `ID: ${targetUser.id}` })
                .setTimestamp();

            return await ctx.sendMessage({ embeds: [kickEmbed] });

        } catch (error) {
            console.error("Kick Error:", error);
            const embed = new EmbedBuilder().setColor(Colors.Red).setDescription("<:Cross:1375519752746958858> An error occurred while trying to remove this user");
            return await ctx.sendMessage(
                {
                    embeds: [embed]
                });
        }
    }
}
