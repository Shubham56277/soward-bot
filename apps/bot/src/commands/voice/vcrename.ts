import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcRenameCommand extends Command {
    constructor() {
        super({
            name: "vcrename",
            description: {
                content: "Rename a voice channel",
                usage: "vcrename <name>",
                examples: ["vcrename New Name"]
            },
            category: "voice",
            aliases: ["vrename"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["ManageChannels"],
                user: ["ManageChannels"]
            },
            slashCommand: false,
            options: [
                {
                    name: "name",
                    description: "New channel name",
                    type: 3,
                    required: true
                }
            ]
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author!.id);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const newName = ctx.options.getString("name");
        if (!newName) return ctx.sendMessage("Please provide a new name.");

        await currentVC.setName(newName, `Renamed by ${ctx.author!.tag}`);
        return ctx.sendMessage(`Renamed channel to: ${newName}`);
    }
}