import { EmbedBuilder, GuildMember, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Ban extends Command {
    constructor() {
        super({
            name: "ban",
            description: {
                content: "Permanently ban a user from the server",
                examples: [
                    "ban @user Breaking rules",
                    "ban 123456789012345678 Spam"
                ],
                usage: "ban <user> [reason]",
            },
            category: "moderation",
            aliases: ["banish", "remove", "hackban"],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["BanMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
                user: ["BanMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to ban",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the ban",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: "silent",
                    description: "Whether to notify the user about the ban",
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
        const silent = ctx.options.getBoolean("silent", false, 2) ?? false;

        // Handle user not found
        if (!targetUser) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("User not found");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Get reason
        let reason = ctx.options.getString("reason", false, 1) || "No reason provided";

        // Handle text command arguments
        if (!ctx.isInteraction) {
            const args = ctx.args.slice(1);
            if (args.length > 0) {
                reason = args.join(" ");
            }
        }

        if (targetUser.id === ctx.author?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot ban yourself");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (targetUser.id === ctx.client.user?.id) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot ban me");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (targetUser.id === ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot ban the server owner");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        const moderatorPosition = ctx.member?.roles.highest.position ?? 0;
        if (target && target.roles.highest.position >= moderatorPosition && ctx.author?.id !== ctx.guild.ownerId) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("You cannot ban someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (target && ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription(" I cannot ban someone with higher or equal role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        try {
            // Notify user if not silent
            if (!silent) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setTitle(`You've been banned from ${ctx.guild.name}`)
                        .setDescription(`**Reason:** ${reason}\n**Moderator:** ${ctx.author?.toString() || "Unknown"}`)
                        .setTimestamp();

                    await targetUser.send({ embeds: [dmEmbed] });
                } catch {
                    // DMs are closed, continue anyway
                }
            }

            // Execute the ban
            await ctx.guild.members.ban(targetUser, { reason });

            // Create audit log embed
            const banEmbed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle("🔨 Member Banned")
                .setDescription(
                    `**User:** ${targetUser.toString()}\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setThumbnail(targetUser.displayAvatarURL())
                .setFooter({ text: `ID: ${targetUser.id}` })
                .setTimestamp();

            return await ctx.sendMessage({ embeds: [banEmbed] });

        } catch (error) {
            console.error("Ban Error:", error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("<:Cross:1375519752746958858> An error occurred while trying to ban this user");
            return await ctx.sendMessage({ embeds: [embed] });
        }
    }
}
