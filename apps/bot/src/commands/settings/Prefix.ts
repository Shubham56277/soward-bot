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
            options: [
                {
                    name: "prefix",
                    description: "The new prefix for this server",
                    type: 3,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const prefix = ctx.options.getString("prefix");

        if (prefix === "reset") {
            return this.resetPrefix(ctx);
        }

        return this.setPrefix(ctx, prefix);
    }

    private async setPrefix(ctx: Context, prefix: string) {
        await Guild.update(ctx.guild!.id, {
            prefix,
        });

        return ctx.sendMessage({
            components: [
                new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`<:Tick:1375519268292264012> Successfully set prefix to \`${prefix}\``)
                )
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
                    new TextDisplayBuilder().setContent(`<:Tick:1375519268292264012> Reset prefix to \`${ctx.client.config.prefix}\``)
                )
            ],
            flags: MessageFlags.IsComponentsV2,
        });
    }
}
