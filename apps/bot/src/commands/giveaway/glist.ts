import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Giveaway, Guild } from "@repo/db";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

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

        const pages: ContainerBuilder[] = [];
        for (let i = 0; i < allGiveaways.length; i += 5) {
            const pageGiveaways = allGiveaways.slice(i, i + 5);
            const body = pageGiveaways
                .map((giveaway, index) => {
                    const status = giveaway.ended
                        ? "Ended"
                        : giveaway.paused
                        ? "Paused"
                        : "Active";
                    return `**#${i + index + 1}**\nChannel: <#${giveaway.channelId}>\nPrize: ${giveaway.prize}\nHosted by: <@${giveaway.hostedBy}>\nLink: [Go to message](https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId})\nStatus: ${status}`;
                })
                .join("\n\n")
                + `\n\n-# Total: ${allGiveaways.length} giveaways`;
            pages.push(buildPanel("Giveaways", body));
        }

        if (pages.length === 1) {
            return ctx.sendMessage({ components: [pages[0]!], flags: MessageFlags.IsComponentsV2 });
        }

        let currentPage = 0;

        const createNav = (page: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("glist_first").setLabel("|←").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId("glist_prev").setLabel("←").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId("glist_page").setLabel(`${page + 1}/${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId("glist_next").setLabel("→").setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
            new ButtonBuilder().setCustomId("glist_last").setLabel("→|").setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
        );

        const msg = await ctx.sendMessage({
            components: [pages[currentPage]!, createNav(currentPage)],
            flags: MessageFlags.IsComponentsV2,
        });

        const collector = msg.createMessageComponentCollector({
            filter: (i) => i.user.id === ctx.author?.id,
            time: 300_000,
        });

        collector.on("collect", async (i) => {
            if (i.customId === "glist_first") currentPage = 0;
            else if (i.customId === "glist_prev") currentPage--;
            else if (i.customId === "glist_next") currentPage++;
            else if (i.customId === "glist_last") currentPage = pages.length - 1;
            await i.update({ components: [pages[currentPage]!, createNav(currentPage)] });
        });

        collector.on("end", () => {
            msg.edit({ components: [pages[currentPage]!] }).catch(() => {});
        });
    }
}
