import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

export default class Modlogs extends Command {
    constructor() {
        super({
            name: "modlogs",
            description: {
                content: "View moderation history for a user",
                examples: ["modlogs @user", "modlogs 123456789012345678"],
                usage: "modlogs <user>",
            },
            category: "moderation",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: ["ModerateMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to view moderation history for",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const targetUser = ctx.options.getUser("user", true);

        if (!targetUser) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("User not found."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const warnings = await Warning.getUserWarnings(ctx.guild.id, targetUser.id);

        if (warnings.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`No moderation history found for **${targetUser.tag}**.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const formattedLogs = warnings.map((warn, index) => {
            return `**#${index + 1}** \`${warn.id}\`\n> **Reason:** ${warn.reason}\n> **Moderator:** <@${warn.moderatorId}>\n> **Date:** <t:${Math.floor(warn.createdAt.getTime() / 1000)}:R>`;
        }).join("\n\n");

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Moderation History — ${targetUser.tag}** (${warnings.length} entries)`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(formattedLogs))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# User ID: ${targetUser.id}`));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
