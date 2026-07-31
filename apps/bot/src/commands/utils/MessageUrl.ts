import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class MessageUrlCommand extends Command {
    constructor() {
        super({
            name: "messageurl",
            description: {
                content: "Get the URL/link of a message by ID",
                examples: ["messageurl <message_id>"],
                usage: "messageurl <message_id>",
            },
            category: "utils",
            cooldown: 3,
            args: true,
            permissions: { dev: false, client: ["SendMessages"], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const messageId = ctx.args[0];
        if (!messageId) {
            if (ctx.message?.reference?.messageId) {
                const url = `https://discord.com/channels/${ctx.guild.id}/${ctx.channelId}/${ctx.message.reference.messageId}`;
                return ctx.sendMessage({ content: url, allowedMentions: { parse: [] } });
            }
            return ctx.sendMessage("Provide a message ID or reply to a message.");
        }

        const url = `https://discord.com/channels/${ctx.guild.id}/${ctx.channelId}/${messageId}`;
        return ctx.sendMessage({ content: url, allowedMentions: { parse: [] } });
    }
}
