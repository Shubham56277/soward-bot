import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StickerInfoCommand extends Command {
    constructor() {
        super({
            name: "stickerinfo",
            description: {
                content: "Get information about a sticker",
                examples: ["stickerinfo <sticker_id>"],
                usage: "stickerinfo <sticker_id>",
            },
            category: "utils",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages"],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const stickerId = ctx.args[0];
        if (!stickerId) return ctx.sendMessage("Provide a sticker ID. You can get it by replying to a message with a sticker.");

        const sticker = ctx.guild.stickers.cache.get(stickerId) ?? await ctx.guild.stickers.fetch(stickerId).catch(() => null);
        if (!sticker) return ctx.sendMessage("Sticker not found in this server.");

        const info = [
            `**Name:** ${sticker.name}`,
            `**ID:** \`${sticker.id}\``,
            `**Tags:** ${sticker.tags ?? "None"}`,
            `**Format:** ${sticker.format}`,
            `**Description:** ${sticker.description || "None"}`,
            `**URL:** ${sticker.url}`,
        ].join("\n");

        return ctx.sendMessage({ content: info, allowedMentions: { parse: [] } });
    }
}
