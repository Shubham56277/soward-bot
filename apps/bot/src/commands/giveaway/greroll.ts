import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { giveawaysManager } from "../../lib/giveaways/giveawaysManager";
import { Giveaway, Guild } from "@repo/db";

export default class GRerollCommand extends Command {
    constructor() {
        super({
            name: "greroll",
            description: {
                content: "Reroll a giveaway",
                examples: ["greroll <messageId>"],
                usage: "greroll <messageId>",
            },
            category: "giveaway",
            aliases: ["giveawayreroll"],
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
               
            },
            slashCommand: false,
            options: [
                {
                    name: "message",
                    description: "Message ID of the giveaway",
                    type: 3,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const guild = await Guild.get(ctx.guild!.id!);
        const gManagerRole = ctx.guild?.roles.cache.get(guild.giveawaysManagerRole!);
        if (gManagerRole && !ctx.member?.roles.cache.has(gManagerRole.id) || !ctx.member?.permissions.has("ManageGuild")) {
            return ctx.sendMessage({
                content: "You need to be a giveaways manager to use this command",
            });
        }
        const messageId = ctx.options.getString("message", true);
        const giveaway = await Giveaway.get(ctx.guild!.id, messageId);

        if (!giveaway) {
            return ctx.sendMessage({
                content: "Giveaway not found",
                flags: MessageFlags.Ephemeral,
            });
        }

        await giveawaysManager.reroll(ctx, ctx.guild!.id, messageId);
        return ctx.sendMessage({
            content: "Giveaway rerolled",
            flags: MessageFlags.Ephemeral,
        });
    }
}
