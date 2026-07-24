import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

export default class ClearWarn extends Command {
    constructor() {
        super({
            name: "clearwarn",
            description: {
                content: "Clear all warnings for a user",
                examples: ["clearwarn @user"],
                usage: "clearwarn <user>",
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
                    description: "The user to clear warnings for",
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

        const count = await Warning.getUserWarningCount(ctx.guild.id, targetUser.id);

        if (count === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${targetUser.toString()} has no warnings to clear.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        await Warning.deleteAllUserWarnings(ctx.guild.id, targetUser.id);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Warnings Cleared**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `Cleared **${count}** warning${count !== 1 ? "s" : ""} for ${targetUser.toString()}.`
            ));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
