import { GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcPullCommand extends Command {
    constructor() {
        super({
            name: "vcpull",
            description: {
                content: "Pull a user to your voice channel",
                usage: "vcpull <user>",
                examples: ["vcpull @user"]
            },
            category: "voice",
            aliases: ["vpull"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["MoveMembers"],
                user: ["MoveMembers"]
            },
            slashCommand: false,
            options: [
                {
                    name: "user",
                    description: "User to pull",
                    type: 6,
                    required: true
                }
            ]
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author?.id!);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const targetUser = ctx.options.getMember("user") as GuildMember;
        if (!targetUser) return ctx.sendMessage("Please specify a user.");
        if (!targetUser.voice.channel) return ctx.sendMessage("User not in VC.");

        await targetUser.voice.setChannel(currentVC.id, `Pulled by ${ctx.author?.tag}`);
        return ctx.sendMessage(`Pulled ${targetUser} to your voice channel`);
    }
}