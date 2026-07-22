import { ChannelType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcMoveAllCommand extends Command {
    constructor() {
        super({
            name: "vcmoveall",
            description: {
                content: "Move all users to a voice channel",
                usage: "vcmoveall <channel>",
                examples: ["vcmoveall #channel"],
            },
            category: "voice",
            aliases: ["vmoveall"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["MoveMembers"],
                user: ["MoveMembers"],
            },
            slashCommand: false,
            options: [
                {
                    name: "channel",
                    description: "Target channel",
                    type: 7,
                    channel_types: [ChannelType.GuildVoice],
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author?.id!);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const targetChannel = ctx.options.getChannel("channel");
        if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
            return ctx.sendMessage("Invalid voice channel.");
        }

        const moved = [];
        for (const [_, member] of currentVC.members) {
            await member.voice.setChannel(
                targetChannel.id,
                `Mass moved by ${ctx.author?.tag}`,
            );
            moved.push(member);
        }

        return ctx.sendMessage(
            `Moved ${moved.length} users to ${targetChannel}`,
        );
    }
}
