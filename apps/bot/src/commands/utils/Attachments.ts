import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class AttachmentsCommand extends Command {
    constructor() {
        super({
            name: "attachments",
            description: {
                content: "Get all attachments from a message (reply to it)",
                examples: ["attachments"],
                usage: "attachments [message_id]",
            },
            category: "utils",
            cooldown: 5,
            args: false,
            permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory"], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        let targetMsg = ctx.message;

        // If replying to a message, use that
        if (ctx.message?.reference?.messageId) {
            const channel = ctx.channel;
            if ("messages" in channel) {
                targetMsg = await (channel as any).messages.fetch(ctx.message.reference.messageId).catch(() => null);
            }
        } else if (ctx.args[0]) {
            const channel = ctx.channel;
            if ("messages" in channel) {
                targetMsg = await (channel as any).messages.fetch(ctx.args[0]).catch(() => null);
            }
        }

        if (!targetMsg) return ctx.sendMessage("Message not found.");

        const attachments = targetMsg.attachments;
        if (!attachments || attachments.size === 0) return ctx.sendMessage("No attachments found on that message.");

        const urls = attachments.map((a: any) => a.url).join("\n");
        return ctx.sendMessage({ content: `**Attachments (${attachments.size}):**\n${urls}`, allowedMentions: { parse: [] } });
    }
}
