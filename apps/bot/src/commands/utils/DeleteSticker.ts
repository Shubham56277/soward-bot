import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class DeleteStickerCommand extends Command {
    constructor() {
        super({
            name: "deletesticker",
            description: {
                content: "Delete a sticker from the server",
                examples: ["deletesticker <sticker_id>"],
                usage: "deletesticker <sticker_id>",
            },
            category: "utils",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ManageGuildExpressions"],
                user: ["ManageGuildExpressions"],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const stickerId = ctx.args[0];
        if (!stickerId) return ctx.sendMessage("Provide a sticker ID to delete.");

        const sticker = ctx.guild.stickers.cache.get(stickerId) ?? await ctx.guild.stickers.fetch(stickerId).catch(() => null);
        if (!sticker) return ctx.sendMessage("Sticker not found in this server.");

        const name = sticker.name;
        await sticker.delete(`Deleted by ${ctx.author?.username}`);
        return ctx.sendMessage(`✅ Deleted sticker **${name}**`);
    }
}
