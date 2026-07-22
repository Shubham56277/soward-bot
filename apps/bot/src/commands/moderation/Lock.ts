import { EmbedBuilder, TextChannel, ApplicationCommandOptionType, Colors } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Lock extends Command {
    constructor() {
        super({
            name: "lock",
            description: {
                content: "Lock a specific channel",
                examples: ["lock #general", "lock 123456789012345678"],
                usage: "lock [channel] <reason>",
            },
            category: "moderation",
            aliases: ["lockdown"],
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["ManageChannels", "SendMessages"],
                user: ["ManageChannels"],
            },
            slashCommand: true,
            options: [
                {
                    name: "channel",
                    description: "Channel to lock (defaults to current)",
                    type: ApplicationCommandOptionType.Channel,
                    required: false,
                },
                {
                    name: "reason",
                    description: "Reason for locking",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const channel = ctx.options?.getChannel("channel") as TextChannel || ctx.channel as TextChannel;
        const reason = ctx.options?.getString("reason") || ctx.args?.join(" ") || "No reason provided";

        if (!channel.isTextBased()) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Only text channels can be locked");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        try {
            await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false
            });

            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setTitle("🔒 Channel Locked")
                .setDescription(
                    `${channel} has been locked\n\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setTimestamp();
            return await ctx.sendMessage({ embeds: [embed] });

        } catch (error) {
            console.error("Lock Error:", error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("Failed to lock this channel");
            return await ctx.sendMessage({ embeds: [embed] });
        }
    }
}