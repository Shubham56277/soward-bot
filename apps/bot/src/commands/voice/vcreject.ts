import { GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcRejectCommand extends Command {
    constructor() {
        super({
            name: "vcreject",
            description: {
                content: "Reject user from voice channel",
                usage: "vcreject <user>",
                examples: ["vcreject @user"]
            },
            category: "voice",
            aliases: ["vreject"],
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
                    description: "User to reject",
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
            Connect: false
        }, { reason: `Rejected by ${ctx.author!.tag}` });

        if (targetUser.voice.channel?.id === currentVC.id) {
            await targetUser.voice.disconnect(`Rejected by ${ctx.author!.tag}`);
        }

        return ctx.sendMessage(`<:Cross:1375519752746958858> ${targetUser} can no longer join this channel`);
    }
}