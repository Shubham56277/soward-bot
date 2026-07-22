import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AFK } from "@repo/db";

export default class AfkCommand extends Command {
    constructor() {
        super({
            name: 'afk',
            description: {
                content: 'Sets your AFK status',
                examples: ['afk'],
                usage: 'afk <reason>',
            },
            category: 'utils',
            aliases: ['pong'],
            cooldown: 8,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "reason",
                    type: 3,
                    description: "Reason for AFK",
                    required: false
                }
            ],
        });
    }
    public async run(ctx: Context): Promise<any> {
        let reason = ctx.args.join(" ");
        if (ctx.isInteraction) reason = ctx.options.getString("reason", false) as string;
        if (reason) {
            const regex = /https?:\/\/[^\s]+/g;
            reason = reason.replace(regex, "");
            if (reason.includes("discord.gg/")) {
                reason = reason.replace(/discord\.gg\/[^\s]+/g, "");
            }
        }
        const buttons = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("afk-global")
                    .setLabel("Global")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("afk-server")
                    .setLabel(`For ${(ctx.guild?.name?.length ?? 0) > 20 ? `${ctx.guild?.name?.slice(0, 20)}...` : (ctx.guild?.name ?? "server")}`)
                    .setStyle(ButtonStyle.Primary)
            );

        const message = await ctx.editOrReply({
            embeds: [
                {
                    color: ctx.client.config.colors.main,
                    description: [
                        "Hey! Where would you like to set your AFK?",
                        "You can go AFK just in this server or across all servers."
                    ].join("\n"),
                },
            ],
            components: [buttons],
        });

        const collector = message.createMessageComponentCollector({
            time: 60 * 1000, // 1 minute
            componentType: ComponentType.Button,
            filter: async (i) => {
                if (i.user.id === ctx.author?.id) {
                    return true;
                }
                await i.reply({
                    embeds: [
                        {
                            color: ctx.client.config.colors.red,
                            description: "You are not allowed to use this button.",
                        },
                    ],
                    flags: MessageFlags.Ephemeral
                });
                return false;
            }
        });

        collector.on("collect", async (i) => {
            let type: string = "";
            if (i.customId === "afk-global") {
                await AFK.create(ctx.author?.id ?? "", {
                    reason,
                    mentionBy: [],
                    global: true,
                });
                type = "global";
            } else if (i.customId === "afk-server") {
                await AFK.create(ctx.author?.id ?? "", {
                    reason,
                    mentionBy: [],
                    guildId: ctx.guild?.id,
                });
                type = `${ctx.guild?.name}`;
            }
            return i.update({
                embeds: [
                    {
                        color: ctx.client.config.colors.main,
                        author: {
                            name: `${ctx.client.user?.username} Afk System!`,
                            icon_url: ctx.client.user?.avatarURL() || ""
                        },
                        description: `Your Afk has been set \`${type === "global" ? "Globally" : `Server: ${type}`}\` ${reason ? `Reason: ${reason}` : ""}`,
                        thumbnail: {
                            url: ctx.author?.avatarURL() || ""
                        }
                    },
                ],
                components: [],
            });
        });
    }
}
