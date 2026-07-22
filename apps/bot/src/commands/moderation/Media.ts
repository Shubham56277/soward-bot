import { MediaChannel } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ChannelType, EmbedBuilder, TextChannel } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";

export default class Media extends Command {
    constructor() {
        super({
            name: "media",
            description: {
                content: "Manage media-only channels",
                examples: [
                    "media add #channel",
                    "media remove #channel",
                    "media list",
                ],
                usage: "media <subcommand>",
            },
            category: "moderation",
            aliases: ["mediachannel"],
            cooldown: 10,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: [
                    "ManageChannels",
                    "ManageMessages",
                    "ManageWebhooks",
                ],
                user: ["ManageChannels"],
            },
            slashCommand: false,
            options: [
                {
                    name: "add",
                    description: "Channel to add as media channel",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "channel",
                            description: "Channel to add as media channel",
                            type: 7,
                            channel_types: [ChannelType.GuildText],
                            required: true,
                        },
                    ],
                },
                {
                    name: "remove",
                    description: "Channel to remove as media channel",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "channel",
                            description: "Channel to remove as media channel",
                            type: 7,
                            channel_types: [ChannelType.GuildText],
                            required: true,
                        },
                    ],
                },
                {
                    name: "list",
                    description: "List all media channels",
                    type: ApplicationCommandOptionType.Subcommand,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const subcommand = ctx.options.getSubCommand();

        switch (subcommand) {
            case "add":
                return this.addMediaChannel(ctx);
            case "remove":
                return this.removeMediaChannel(ctx);
            case "list":
                return this.listMediaChannels(ctx);
            default:
                return ctx.sendMessage(
                    "Invalid subcommand. Use: add, remove, list",
                );
        }
    }

    private async addMediaChannel(ctx: Context): Promise<any> {
        const channel = ctx.options.getChannel(
            "channel",
            true,
            1,
        ) as TextChannel;

        if (!channel || channel.type !== ChannelType.GuildText) {
            return ctx.sendMessage("Please specify a valid text channel.");
        }

        const exists = await MediaChannel.getByGuildIdAndChannelId(
            ctx.guild.id,
            channel.id,
        );

        if (exists) {
            return ctx.sendMessage("This channel is already a media channel.");
        }

        await MediaChannel.create({
            guildId: ctx.guild.id,
            channelId: channel.id,
        });

        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle("Media Channel Configured")
            .setDescription(`${channel} is now a media-only channel.`)
            .addFields([
                {
                    name: "Rules",
                    value:
                        "Only media attachments will be preserved. Text messages will be deleted.",
                },
            ]);

        return ctx.sendMessage({ embeds: [embed] });
    }

    private async removeMediaChannel(ctx: Context): Promise<any> {
        const channel = ctx.options.getChannel(
            "channel",
            true,
            1,
        ) as TextChannel;

        if (!channel) {
            return ctx.sendMessage("Please specify a valid text channel.");
        }

        // Remove from database
        const result = await MediaChannel.getByGuildIdAndChannelId(
            ctx.guild.id,
            channel.id,
        );

        if (!result) {
            return ctx.sendMessage("This channel is not a media channel.");
        }

        await MediaChannel.delete(result.id);
        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle("Media Channel Removed")
            .setDescription(`${channel} is no longer a media-only channel.`);

        return ctx.sendMessage({ embeds: [embed] });
    }

    private async listMediaChannels(ctx: Context): Promise<any> {
        const mediaChannels = await MediaChannel.getAllByGuildId(ctx.guild.id);

        if (mediaChannels.length === 0) {
            return ctx.sendMessage(
                "No media channels configured in this server.",
            );
        }

        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle("Media Channels")
            .setDescription(
                mediaChannels.map((mc) => {
                    const channel = ctx.guild.channels.cache.get(mc.channelId);
                    return channel
                        ? `${channel}`
                        : `Deleted Channel (ID: ${mc.channelId})`;
                }).join("\n"),
            );

        return ctx.sendMessage({ embeds: [embed] });
    }
}
