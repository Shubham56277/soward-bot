import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcUnhideCommand extends Command {
    constructor() {
        super({
            name: "vcunhide",
            description: {
                content: "Unhide a voice channel",
                usage: "vcunhide",
                examples: ["vcunhide"]
            },
            category: "voice",
            aliases: ["vunhide"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["ManageChannels"],
                user: ["ManageChannels"]
            },
            slashCommand: false
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author!.id);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        await currentVC.permissionOverwrites.edit(ctx.guild.roles.everyone, {
            ViewChannel: null
        }, { reason: `Unhidden by ${ctx.author!.tag}` });

        return ctx.sendMessage(`👀 ${currentVC} is now visible`);
    }
}