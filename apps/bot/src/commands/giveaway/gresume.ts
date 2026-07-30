import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Giveaway } from "@repo/db";
import { hasGiveawayPerms } from "../../utils/giveawayPerms";

export default class GResumeCommand extends Command {
    constructor() {
        super({
            name: "gresume",
            description: {
                content: "Resume a paused giveaway",
                examples: ["gresume <messageId>"],
                usage: "gresume <messageId>",
            },
            category: "giveaway",
            aliases: ["giveawayresume"],
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
        if (!(await hasGiveawayPerms(ctx.member as any, ctx.guild!.id))) {
            return ctx.sendMessage("You need to be a giveaway manager or have Manage Server permission to use this command.");
        }
        const messageId = ctx.options.getString("message", true);
        const giveaway = await Giveaway.get(ctx.guild!.id, messageId);

        if (!giveaway) {
            return ctx.sendMessage({
                content: "Giveaway not found",
                flags: MessageFlags.Ephemeral,
            });
        }

        giveaway.paused = false;
        await Giveaway.update(ctx.guild!.id, messageId, giveaway);
        return ctx.sendMessage({
            content: "Giveaway resumed",
            flags: MessageFlags.Ephemeral,
        });
    }
}
