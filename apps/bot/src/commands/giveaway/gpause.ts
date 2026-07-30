import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Giveaway } from "@repo/db";
import { hasGiveawayPerms } from "./giveawayPerms";

export default class GPauseCommand extends Command {
    constructor() {
        super({
            name: "gpause",
            description: {
                content: "Pause a giveaway",
                examples: ["gpause <messageId>"],
                usage: "gpause <messageId>",
            },
            category: "giveaway",
            aliases: ["giveawaypause"],
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

        giveaway.paused = true;
        await Giveaway.update(ctx.guild!.id, messageId, giveaway);
        return ctx.sendMessage({
            content: "Giveaway paused",
            flags: MessageFlags.Ephemeral,
        });
    }
}
