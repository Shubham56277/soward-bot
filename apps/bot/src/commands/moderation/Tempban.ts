import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import ms from "@lukeed/ms";

export default class Tempban extends Command {
    constructor() {
        super({
            name: "tempban",
            description: {
                content: "Temporarily ban a user from the server",
                examples: ["tempban @user 1h Spamming", "tempban @user 2d Breaking rules"],
                usage: "tempban <user> <duration> [reason]",
            },
            category: "moderation",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["BanMembers", "SendMessages", "ViewChannel"],
                user: ["BanMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to temporarily ban",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "duration",
                    description: "Ban duration (e.g. 1h, 2d, 30m)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the ban",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const targetUser = ctx.options.getUser("user", true, 0);
        const durationStr = ctx.options.getString("duration", true, 1);
        const reason = ctx.options.getString("reason", false, 2) ?? "No reason provided";

        if (!targetUser) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("User not found."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!durationStr) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a duration (e.g. `1h`, `2d`, `30m`)."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const duration = ms.parse(durationStr);

        if (!duration || Number.isNaN(duration) || duration <= 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Invalid duration format. Use examples like `30m`, `2h`, `1d`."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (targetUser.id === ctx.author?.id) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("You cannot ban yourself."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (targetUser.id === ctx.guild.ownerId) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("You cannot ban the server owner."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = await ctx.guild.members.fetch(targetUser.id).catch(() => null);
        if (member && !member.bannable) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("I cannot ban that member (their role is above mine)."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await ctx.guild.members.ban(targetUser, { reason: `[TEMPBAN ${durationStr}] ${reason}` });

            const unbanAt = Math.floor((Date.now() + duration) / 1000);

            // Schedule automatic unban
            setTimeout(async () => {
                try {
                    await ctx.guild.bans.remove(targetUser.id, "Temporary ban expired");
                } catch {
                    // User may have been unbanned manually — ignore
                }
            }, duration);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Temporary Ban Issued**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**User:** ${targetUser.toString()}\n` +
                    `**Duration:** ${durationStr}\n` +
                    `**Expires:** <t:${unbanAt}:R>\n` +
                    `**Reason:** ${reason}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}`
                ));

            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error("Tempban Error:", error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("An error occurred while trying to ban this user."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
