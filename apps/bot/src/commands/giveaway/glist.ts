import { EmbedBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Giveaway, Guild } from "@repo/db";
import { Pagination } from "../../utils/Pagination";

export default class GListCommand extends Command {
    constructor() {
        super({
            name: "glist",
            description: {
                content: "List all giveaways",
                examples: ["glist"],
                usage: "glist",
            },
            category: "giveaway",
            aliases: ["giveawaylist"],
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
            },
            slashCommand: false,
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
        const allGiveaways = await Giveaway.getAll(ctx.guild!.id);

        if (!allGiveaways?.length) {
            return ctx.sendMessage({
                content: "No giveaways found",
                flags: MessageFlags.Ephemeral,
            });
        }

        allGiveaways.sort((a, b) =>
            new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
        );
        const embeds: EmbedBuilder[] = [];

        for (let i = 0; i < allGiveaways.length; i += 5) {
            const pageGiveaways = allGiveaways.slice(i, i + 5);
            const em = new EmbedBuilder()
                .setColor(ctx.client.config.colors.main)
                .setTitle("Giveaways")
                .setDescription(
                    pageGiveaways
                        .map((giveaway, index) => {
                            const status = giveaway.ended
                                ? "Ended"
                                : giveaway.paused
                                ? "Paused"
                                : "Active";
                            return `**#${
                                i + index + 1
                            }**\nChannel: <#${giveaway.channelId}>\nPrize: ${giveaway.prize}\nHosted by: <@${giveaway.hostedBy}>\nLink: [Go to message](https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId})\nStatus: ${status}`;
                        })
                        .join("\n\n"),
                )
                .setFooter({ text: `Total: ${allGiveaways.length} giveaways` });
            embeds.push(em);
        }

        const pagination = new Pagination(ctx, embeds);
        await pagination.start();
    }
}
