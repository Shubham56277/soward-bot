import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class DeleteEmojiCommand extends Command {
    constructor() {
        super({
            name: "deleteemoji",
            description: {
                content: "Delete an emoji from the server",
                examples: ["deleteemoji :emoji:"],
                usage: "deleteemoji <emoji>",
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
        const input = ctx.args[0];
        if (!input) return ctx.sendMessage("Provide an emoji to delete.");

        const match = input.match(/<a?:\w+:(\d+)>/);
        if (!match) return ctx.sendMessage("Provide a valid custom emoji from this server.");

        const emoji = ctx.guild.emojis.cache.get(match[1]!);
        if (!emoji) return ctx.sendMessage("That emoji is not from this server.");
        if (!emoji.deletable) return ctx.sendMessage("I cannot delete that emoji.");

        const name = emoji.name;
        await emoji.delete(`Deleted by ${ctx.author?.username}`);
        return ctx.sendMessage(`✅ Deleted emoji **${name}**`);
    }
}
