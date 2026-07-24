import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Warning } from "@repo/db";

export default class Reason extends Command {
    constructor() {
        super({
            name: "reason",
            description: {
                content: "Edit the reason for a moderation case",
                examples: ["reason abc123 Updated reason here"],
                usage: "reason <case_id> <reason>",
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
                    name: "case_id",
                    description: "The ID of the moderation case",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "reason",
                    description: "The new reason for the case",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const caseId = ctx.options.getString("case_id", true, 0);
        const newReason = ctx.isInteraction
            ? ctx.options.getString("reason", true, 1)
            : ctx.args.slice(1).join(" ");

        if (!caseId) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a case ID."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!newReason) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a new reason."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const warning = await Warning.getById(caseId);

        if (!warning || warning.guildId !== ctx.guild.id) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Case \`${caseId}\` not found in this server.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        await Warning.update(caseId, newReason);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Case Updated**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Case ID:** \`${caseId}\`\n` +
                `**New Reason:** ${newReason}\n` +
                `**Updated by:** ${ctx.author?.toString() ?? "Unknown"}`
            ));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
