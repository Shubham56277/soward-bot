import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import ms from "@lukeed/ms";

export default class Remind extends Command {
    constructor() {
        super({
            name: "remind",
            description: {
                content: "Set a reminder that will be sent to your DMs",
                examples: ["remind 1h Check the oven", "remind 30m Take a break"],
                usage: "remind <time> <message>",
            },
            category: "utils",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "time",
                    description: "When to remind you (e.g. 1h, 30m, 2d)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "message",
                    description: "What to remind you about",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const timeStr = ctx.options.getString("time", true, 0);
        const reminderText = ctx.isInteraction
            ? ctx.options.getString("message", true, 1)
            : ctx.args.slice(1).join(" ");

        if (!timeStr) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a time for the reminder (e.g. `1h`, `30m`)."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!reminderText) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a reminder message."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const duration = ms.parse(timeStr);

        if (!duration || Number.isNaN(duration) || duration <= 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Invalid time format. Use examples like `30m`, `2h`, `1d`."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days
        if (duration > maxDuration) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Maximum reminder time is 7 days."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const remindAt = Math.floor((Date.now() + duration) / 1000);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reminder Set**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `I'll DM you <t:${remindAt}:R> about:\n> ${reminderText}`
            ));

        await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

        // Schedule the reminder DM
        setTimeout(async () => {
            try {
                await ctx.author?.send(
                    `⏰ **Reminder!**\n\nYou asked me to remind you:\n> ${reminderText}\n\n-# Set in **${ctx.guild.name}** <t:${Math.floor((Date.now() - duration) / 1000)}:R>`
                );
            } catch {
                // User has DMs closed — silently ignore
            }
        }, duration);
    }
}
