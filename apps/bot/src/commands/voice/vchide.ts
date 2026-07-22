import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcHideCommand extends Command {
    constructor() {
        super({
            name: "vchide",
            description: {
                content: "Hide a voice channel",
                usage: "vchide",
                examples: ["vchide"]
            },
            category: "voice",
            aliases: ["vhide"],
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
            ViewChannel: false
        }, { reason: `Hidden by ${ctx.author!.tag}` });

        return ctx.sendMessage(`👻 Hiden ${currentVC} from view`);
    }
}