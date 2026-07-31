import { ApplicationCommandOptionType, GuildEmoji, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class StealCommand extends Command {
    constructor() {
        super({
            name: "steal",
            description: {
                content: "Steal an emoji or sticker and add it to this server",
                examples: ["steal :emoji:", "steal <emoji_url> name"],
                usage: "steal <emoji> [name]",
            },
            category: "utils",
            cooldown: 10,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ManageGuildExpressions"],
                user: ["ManageGuildExpressions"],
            },
            slashCommand: false,
            options: [
                { name: "emoji", description: "Emoji to steal", type: ApplicationCommandOptionType.String, required: true },
                { name: "name", description: "Name for the emoji", type: ApplicationCommandOptionType.String, required: false },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const input = ctx.args[0];
        if (!input) return ctx.sendMessage("Provide an emoji to steal.");

        // Parse custom emoji format <:name:id> or <a:name:id>
        const emojiMatch = input.match(/<(a?):(\w+):(\d+)>/);
        if (!emojiMatch) {
            // Try URL
            const urlMatch = input.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|gif|webp)/);
            if (!urlMatch) return ctx.sendMessage("Provide a valid custom emoji or emoji URL.");
            const id = urlMatch[1];
            const ext = urlMatch[2];
            const name = ctx.args[1] ?? `stolen_${id}`;
            const url = `https://cdn.discordapp.com/emojis/${id}.${ext}`;

            try {
                const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Stolen by ${ctx.author?.username}` });
                return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
            } catch (e: any) {
                return ctx.sendMessage(`Failed to add emoji: ${e.message ?? "Unknown error"}`);
            }
        }

        const animated = emojiMatch[1] === "a";
        const emojiName = ctx.args[1] ?? emojiMatch[2];
        const emojiId = emojiMatch[3];
        const ext = animated ? "gif" : "png";
        const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;

        try {
            const emoji = await ctx.guild.emojis.create({ attachment: url, name: emojiName!, reason: `Stolen by ${ctx.author?.username}` });
            return ctx.sendMessage(`✅ Added emoji **${emoji.name}** ${emoji.toString()}`);
        } catch (e: any) {
            return ctx.sendMessage(`Failed to add emoji: ${e.message ?? "Unknown error"}`);
        }
    }
}
