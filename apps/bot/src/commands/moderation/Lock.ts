import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, TextChannel, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import * as reply from "../../utils/reply";

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
            return reply.error(ctx, "Only text channels can be locked");
        }

        try {
            await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false
            });

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**🔒 Channel Locked**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `${channel} has been locked\n\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ));

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            console.error("Lock Error:", error);
            return reply.error(ctx, "Failed to lock this channel");
        }
    }
}
