import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

export default class Note extends Command {
    constructor() {
        super({
            name: "note",
            description: {
                content: "Add a moderator note to a user",
                examples: ["note @user Suspected alt account"],
                usage: "note <user> <text>",
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
                    description: "The user to add a note to",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "text",
                    description: "The note text",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const targetUser = ctx.options.getUser("user", true);
        const noteText = ctx.isInteraction
            ? ctx.options.getString("text", true, 1)
            : ctx.args.slice(1).join(" ");

        if (!targetUser) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("User not found."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!noteText) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide note text."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const note = await Warning.create({
            guildId: ctx.guild.id,
            userId: targetUser.id,
            moderatorId: ctx.author?.id ?? "unknown",
            reason: `[NOTE] ${noteText}`,
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Note Added**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**User:** ${targetUser.toString()}\n` +
                `**Note:** ${noteText}\n` +
                `**Added by:** ${ctx.author?.toString() ?? "Unknown"}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Note ID: ${note?.id ?? "unknown"}`));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
