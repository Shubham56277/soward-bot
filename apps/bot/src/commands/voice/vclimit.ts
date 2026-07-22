import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcLimitCommand extends Command {
    constructor() {
        super({
            name: "vclimit",
            description: {
                content: "Set voice channel user limit",
                usage: "vclimit <0-99>",
                examples: ["vclimit 5", "vclimit 0 (unlimited)"]
            },
            category: "voice",
            aliases: ["vlimit"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["ManageChannels"],
                user: ["ManageChannels"]
            },
            slashCommand: false,
            options: [
                {
                    name: "limit",
                    description: "User limit (0-99)",
                    type: 4,
                    required: true,
                    min_value: 0,
                    max_value: 99
                }
            ]
        });
    }

    public async run(ctx: Context): Promise<any> {
        const member = await ctx.guild.members.fetch(ctx.author!.id);
        const currentVC = member.voice.channel;
        if (!currentVC) return ctx.sendMessage("You must be in a VC.");

        const limit = ctx.options.getInteger("limit");
        await currentVC.setUserLimit(limit, `Limit set by ${ctx.author!.tag}`);

        return ctx.sendMessage(
            `Set user limit to ${limit === 0 ? "unlimited" : limit}`
        );
    }
}