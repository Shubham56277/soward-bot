import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcKickAllCommand extends Command {
    constructor() {
        super({
            name: "vckickall",
            description: {
                content: "Kick all users from voice channel",
                usage: "vckickall",
                examples: ["vckickall"]
            },
            category: "voice",
            aliases: ["vkickall"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["MoveMembers"],
                user: ["MoveMembers"]
            },
            slashCommand: false
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author!.id);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const kicked = [];
        for (const [_, member] of currentVC.members) {
            if (member.id === ctx.author!.id) continue;
            await member.voice.disconnect(`Mass kicked by ${ctx.author!.tag}`);
            kicked.push(member);
        }

        return ctx.sendMessage(`Kicked ${kicked.length} members from voice`);
    }
}