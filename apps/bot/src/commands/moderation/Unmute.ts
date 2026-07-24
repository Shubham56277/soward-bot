import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
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

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        let reason = ctx.options.getString("reason", false) || "No reason provided";

        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        if (!target) {
            return await ctx.sendMessage(this.msg("Member not found."));
        }

        if (!target.isCommunicationDisabled()) {
            return await ctx.sendMessage(this.msg("This member is not currently muted."));
        }

        try {
            await target.timeout(null, reason).catch(() => {});

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🔈 Member Unmuted**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**User:** ${target.toString()}\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${target.id}`));

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            console.error("Unmute Error:", error);
            return await ctx.sendMessage(this.msg("An error occurred while trying to unmute this member."));
        }
    }
}
