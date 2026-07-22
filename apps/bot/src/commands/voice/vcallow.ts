import { GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcAllowCommand extends Command {
    constructor() {
        super({
            name: "vcallow",
            description: {
                content: "Allow user to join voice channel",
                usage: "vcallow <user>",
                examples: ["vcallow @user"]
            },
            category: "voice",
            aliases: ["vallow"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["ManageChannels"],
                user: ["ManageChannels"]
            },
            slashCommand: false,
            options: [
                {
                    name: "user",
                    description: "User to allow",
                    type: 6,
                    required: true
                }
            ]
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author!.id);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const targetUser = ctx.options.getMember("user") as GuildMember;
        if (!targetUser) return ctx.sendMessage("Please specify a user.");

        await currentVC.permissionOverwrites.edit(targetUser, {
            Connect: true
        }, { reason: `Allowed by ${ctx.author!.tag}` });

        return ctx.sendMessage(`<:Tick:1375519268292264012> ${targetUser} can now join this channel`);
    }
}