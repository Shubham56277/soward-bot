import { PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Guild } from "@repo/db";

export default class Prefix extends Command {
    constructor() {
        super({
            name: "prefix",
            description: {
                content: "Set or view the bot prefix for this server",
                examples: ["prefix", "prefix !", "prefix reset"],
                usage: "prefix [new prefix | reset]",
            },
            category: "settings",
            aliases: ["setprefix"],
            cooldown: 5,
            args: false,
            permissions: {
                user: [PermissionFlagsBits.Administrator],
                client: ["SendMessages", "EmbedLinks"],
            },
            slashCommand: true,
            // The prefix option is optional to allow viewing the current prefix.
            options: [
                {
                    name: "prefix",
                    description: "The new prefix for this server (or \"reset\" to reset). Omit to view current prefix.",
                    type: 3,
                    required: false,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        // Get the provided prefix argument, if any.
        const prefix = ctx.options.getString("prefix");

        // If no prefix argument was supplied, show the current prefix.
        if (!prefix) {
            return this.viewPrefix(ctx);
        }

        // Handle reset command.
        if (prefix === "reset") {
            return this.resetPrefix(ctx);
        }

        // Otherwise set the new prefix.
        return this.setPrefix(ctx, prefix);
    }

    private async setPrefix(ctx: Context, prefix: string) {
        await Guild.update(ctx.guild!.id, {
            prefix,
        });

        return ctx.sendMessage({
            components: [
                new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`Successfully set prefix to \`${prefix}\``)
                )
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    /**
     * Send a message displaying the current prefix for the guild.
     */
    private async viewPrefix(ctx: Context) {
        // Retrieve the guild data from the database.
        const guild = await Guild.get(ctx.guild!.id);
        const currentPrefix = guild?.prefix ?? ctx.client.config.prefix;
        return ctx.sendMessage({
            components: [
                new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`Current prefix is \`${currentPrefix}\``)
                ),
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    private async resetPrefix(ctx: Context) {
        await Guild.update(ctx.guild!.id, {
            prefix: ctx.client.config.prefix,
        });

        return ctx.sendMessage({
            components: [
                new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`Reset prefix to \`${ctx.client.config.prefix}\``)
                )
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }
}
