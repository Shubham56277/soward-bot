import { MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { giveawaysManager } from "../../lib/giveaways/giveawaysManager";
import { parse } from "@lukeed/ms";
import { Giveaway, Guild } from "@repo/db";

export default class GStartCommand extends Command {
    constructor() {
        super({
            name: "gstart",
            description: {
                content: "Start a giveaway",
                examples: ["gstart <duration> <winners> <prize>"],
                usage: "gstart <duration> <winners> <prize>",
            },
            category: "giveaway",
            aliases: ["giveawaystart", "gcreate"],
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
                //user: ["ManageGuild"],
            },
            slashCommand: false,
            options: [
                {
                    name: "duration",
                    description: "Duration of the giveaway",
                    type: 3,
                    required: true,
                },
                {
                    name: "winners",
                    description: "Number of winners",
                    type: 4,
                    required: true,
                },
                {
                    name: "prize",
                    description: "Prize of the giveaway",
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
        const allGiveaways = await Giveaway.getAll(ctx.guild.id!);

        if (allGiveaways && allGiveaways.filter((g) => !g.ended)?.length >= 3) {
            return ctx.sendMessage({
                content: "You can only have 3 giveaways at once",
            });
        }

        const duration = ctx.options.getString("duration", true, 0);
        const ms = parse(duration);

        if (!ms) {
            return ctx.sendMessage({
                content:
                    "Please provide a valid duration format: 1d, 1h, 1m, 1s",
            });
        }

        const winners = ctx.options.getInteger("winners", true, 1);
        let prize = ctx.options.getString("prize", true, 2);

        if (!ctx.isInteraction) {
            prize = ctx.args.slice(2).join(" ");
        }

        if (!prize) {
            return ctx.sendMessage({
                content: "Please provide a prize",
            });
        }
        
        const giveaway = await giveawaysManager.create(ctx, {
            duration: ms,
            prize: prize,
            winnerCount: winners,
            channel: ctx.channel.id,
        });
        if (!ctx.isInteraction) {
            await ctx.message?.delete().catch(() => {});
        }
        if (giveaway) {
            if (ctx.isInteraction) {
                return ctx.sendMessage({
                    content: `Giveaway created in <#${ctx.channel.id}>`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            await ctx.message?.delete().catch(() => {});
        }

        const oldGiveaways = allGiveaways?.filter((g) =>
            Date.now() - new Date(g.createdAt!).getTime() >
                1000 * 60 * 60 * 24 * 30
        );

        if (oldGiveaways) {
            for (const giveaway of oldGiveaways) {
                await giveawaysManager.delete(
                    ctx,
                    ctx.guild.id!,
                    giveaway.messageId,
                );
            }
        }
    }
}
