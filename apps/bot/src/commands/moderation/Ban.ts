import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        // Get target user
        const target = ctx.options.getMember("user") as GuildMember | null;
        const targetUser = ctx.options.getUser("user", true);
        const silent = ctx.options.getBoolean("silent", false, 2) ?? false;

        if (!targetUser) {
            return await ctx.sendMessage(this.msg("User not found."));
        }

        // Get reason
        let reason = ctx.options.getString("reason", false, 1) || "No reason provided";

        if (!ctx.isInteraction) {
            const args = ctx.args.slice(1);
            if (args.length > 0) reason = args.join(" ");
        }

        if (targetUser.id === ctx.author?.id) {
            return await ctx.sendMessage(this.msg("You cannot ban yourself."));
        }

        if (targetUser.id === ctx.client.user?.id) {
            return await ctx.sendMessage(this.msg("You cannot ban me."));
        }

        if (targetUser.id === ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot ban the server owner."));
        }

        const moderatorPosition = ctx.member?.roles.highest.position ?? 0;
        if (target && target.roles.highest.position >= moderatorPosition && ctx.author?.id !== ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot ban someone with a higher or equal role."));
        }

        if (target && ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            return await ctx.sendMessage(this.msg("I cannot ban someone with a higher or equal role."));
        }

        try {
            // Notify user if not silent
            if (!silent) {
                await targetUser.send(`**You've been banned from ${ctx.guild.name}**\nReason: ${reason}\nModerator: ${ctx.author?.username ?? "Unknown"}`).catch(() => {});
            }

            await ctx.guild.members.ban(targetUser, { reason });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Member Banned**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**User:** ${targetUser.username}\n` +
                    `**Moderator:** ${ctx.author?.username || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${targetUser.id}`));

            const msg = await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
            setTimeout(() => msg?.delete?.().catch(() => {}), 4_000);
            return msg;
        } catch (error) {
            console.error("Ban Error:", error);
            return await ctx.sendMessage(this.msg("An error occurred while trying to ban this user."));
        }
    }
}
