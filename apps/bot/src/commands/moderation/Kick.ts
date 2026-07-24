import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const targetUser = ctx.options.getUser("user", true);
        const silent = ctx.options.getBoolean("silent", false, 1) ?? false;

        if (!targetUser) {
            return await ctx.sendMessage(this.msg("User not found."));
        }

        let reason = ctx.options.getString("reason") || "No reason provided";
        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        if (targetUser.id === ctx.author?.id) {
            return await ctx.sendMessage(this.msg("You cannot kick yourself."));
        }

        if (targetUser.id === ctx.client.user?.id) {
            return await ctx.sendMessage(this.msg("You cannot kick me."));
        }

        if (targetUser.id === ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot kick the server owner."));
        }

        const moderatorPosition = ctx.member?.roles.highest.position ?? 0;
        if (target && target.roles.highest.position >= moderatorPosition && ctx.author?.id !== ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot kick someone with a higher or equal role."));
        }

        if (target && ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            return await ctx.sendMessage(this.msg("I cannot kick someone with a higher or equal role."));
        }

        try {
            if (!silent && target) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle(`You've been removed from ${ctx.guild.name}`)
                        .setDescription(`**Reason:** ${reason}\n**Moderator:** ${ctx.author?.toString() ?? "Unknown"}`)
                        .setTimestamp();
                    await target.send({ embeds: [dmEmbed] });
                } catch {
                    // User has DMs closed
                }
            }

            await ctx.guild.members.kick(targetUser, reason);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**👢 Member Removed**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**User:** ${targetUser.toString()}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${targetUser.id}`));

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error("Kick Error:", error);
            return await ctx.sendMessage(this.msg("<:Cross:1375519752746958858> An error occurred while trying to remove this user."));
        }
    }
}
