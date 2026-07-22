import { GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class VcKickCommand extends Command {
    constructor() {
        super({
            name: "vckick",
            description: {
                content: "Kick a user from voice",
                usage: "vckick <user>",
                examples: ["vckick @user"],
            },
            category: "voice",
            aliases: ["vkick"],
            cooldown: 5,
            permissions: {
                dev: false,
                client: ["MoveMembers"],
                user: ["MoveMembers"],
            },
            slashCommand: false,
            options: [
                {
                    name: "user",
                    description: "User to kick",
                    type: 6,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const targetUser = ctx.options.getMember("user") as GuildMember;
        if (!targetUser) return ctx.sendMessage("Please specify a user.");
        if (!targetUser.voice.channel) {
            return ctx.sendMessage("User not in VC.");
        }

        await targetUser.voice.disconnect(`Kicked by ${ctx.author?.tag}`);
        return ctx.sendMessage(`Kicked ${targetUser} from voice`);
    }
}
