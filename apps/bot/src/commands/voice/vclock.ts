import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcLockCommand extends Command {
    constructor() {
        super({
            name: "vclock",
            description: {
                content: "Lock a voice channel",
                usage: "vclock",
                examples: ["vclock"],
            },
            category: "voice",
            aliases: ["vlock"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["ManageChannels"],
                user: ["ManageChannels"],
            },
            slashCommand: false,
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author?.id!);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        await currentVC.permissionOverwrites.edit(ctx.guild.roles.everyone, {
            Connect: false,
        }, { reason: `Locked by ${ctx.author?.tag}` });

        return ctx.sendMessage(`🔒 Locked ${currentVC}`);
    }
}
