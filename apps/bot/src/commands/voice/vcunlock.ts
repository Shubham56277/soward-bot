import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcUnlockCommand extends Command {
    constructor() {
        super({
            name: "vcunlock",
            description: {
                content: "Unlock a voice channel",
                usage: "vcunlock",
                examples: ["vcunlock"]
            },
            category: "voice",
            aliases: ["vunlock"],
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
        const member = await ctx.guild.members.fetch(ctx.author?.id!);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        await currentVC.permissionOverwrites.edit(ctx.guild.roles.everyone, {
            Connect: null
        }, { reason: `Unlocked by ${ctx.author?.tag}` });

        return ctx.sendMessage(`🔓 Unlocked ${currentVC}`);
    }
}