import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const durationInput = ctx.options.getString("duration", true, 1);
        const duration = ms.parse(durationInput ?? "5minute");
        let reason = ctx.options.getString("reason", false, 2) || "No reason provided";

        if (!ctx.isInteraction) {
            const args = ctx.args;
            if (args.length < 2) {
                return await ctx.sendMessage(this.msg("Please specify both a user and duration."));
            }
            reason = args.slice(2).join(" ") || "No reason provided";
        }

        if (!target) {
            return await ctx.sendMessage(this.msg("Member not found."));
        }

        if (!duration || Number.isNaN(duration)) {
            return await ctx.sendMessage(this.msg("Invalid duration format. Use examples like `30m`, `2h`, `1d`."));
        }

        const minDuration = 10_000;
        const maxDuration = 28 * 24 * 60 * 60 * 1000;

        if (duration < minDuration || duration > maxDuration) {
            return await ctx.sendMessage(this.msg("Duration must be between 10 seconds and 28 days."));
        }

        if (target.id === ctx.author?.id) {
            return await ctx.sendMessage(this.msg("You cannot timeout yourself."));
        }

        if (target.id === ctx.client.user?.id) {
            return await ctx.sendMessage(this.msg("You cannot timeout me."));
        }

        if (target.id === ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot timeout the server owner."));
        }

        if (target.roles.highest.position >= (ctx.member?.roles.highest.position ?? 0) && ctx.author?.id !== ctx.guild.ownerId) {
            return await ctx.sendMessage(this.msg("You cannot timeout someone with a higher or equal role."));
        }

        if (ctx.guild.members.me && target.roles.highest.position >= ctx.guild.members.me.roles.highest.position) {
            return await ctx.sendMessage(this.msg("I cannot timeout someone with a higher or equal role."));
        }

        await target.timeout(duration, reason);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**⏳ Member Timed Out**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**User:** ${target.toString()}\n` +
                `**Duration:** ${durationInput}\n` +
                `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                `**Reason:** ${reason}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${target.id}`));

        return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
