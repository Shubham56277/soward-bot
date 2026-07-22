import { ChannelType, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcMoveCommand extends Command {
    constructor() {
        super({
            name: "vcmove",
            description: {
                content: "Move a user to a voice channel",
                usage: "vcmove <user> [channel]",
                examples: ["vcmove @user", "vcmove @user #channel"],
            },
            category: "voice",
            aliases: ["vmove"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["MoveMembers"],
                user: ["MoveMembers"],
            },
            slashCommand: false,
            options: [
                {
                    name: "user",
                    description: "User to move",
                    type: 6,
                    required: true,
                },
                {
                    name: "channel",
                    description: "Target channel (default: your current VC)",
                    type: 7,
                    channel_types: [ChannelType.GuildVoice],
                    required: false,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author?.id!);
        const currentVC = member.voice.channel;

        const targetUser = ctx.options.getMember("user") as GuildMember;
        const targetChannel = ctx.options.getChannel("channel") || currentVC;

        if (!targetUser) return ctx.sendMessage("Please specify a user.");
        if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
            return ctx.sendMessage("Invalid voice channel.");
        }

        await targetUser.voice.setChannel(
            targetChannel.id,
            `Moved by ${ctx.author?.tag}`,
        );
        return ctx.sendMessage(`Moved ${targetUser} to ${targetChannel}`);
    }
}
