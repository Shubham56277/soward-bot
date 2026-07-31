import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StickerUrlCommand extends Command {
    constructor() {
        super({
            name: "stickerurl",
            description: {
                content: "Get the URL of a sticker",
                examples: ["stickerurl <sticker_id>"],
                usage: "stickerurl <sticker_id>",
            },
            category: "utils",
            cooldown: 5,
            args: true,
            permissions: { dev: false, client: ["SendMessages"], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const stickerId = ctx.args[0];
        if (!stickerId) return ctx.sendMessage("Provide a sticker ID.");

        const sticker = ctx.guild.stickers.cache.get(stickerId) ?? await ctx.guild.stickers.fetch(stickerId).catch(() => null);
        if (!sticker) return ctx.sendMessage("Sticker not found.");

        return ctx.sendMessage({ content: sticker.url, allowedMentions: { parse: [] } });
    }
}
