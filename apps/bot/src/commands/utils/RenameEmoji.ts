import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class RenameEmojiCommand extends Command {
    constructor() {
        super({
            name: "renameemoji",
            description: {
                content: "Rename an emoji in the server",
                examples: ["renameemoji :emoji: newname"],
                usage: "renameemoji <emoji> <new_name>",
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
        const newName = ctx.args[1];
        if (!input || !newName) return ctx.sendMessage("Usage: `renameemoji :emoji: newname`");

        const match = input.match(/<a?:\w+:(\d+)>/);
        if (!match) return ctx.sendMessage("Provide a valid custom emoji from this server.");

        const emoji = ctx.guild.emojis.cache.get(match[1]!);
        if (!emoji) return ctx.sendMessage("That emoji is not from this server.");

        const oldName = emoji.name;
        await emoji.edit({ name: newName, reason: `Renamed by ${ctx.author?.username}` });
        return ctx.sendMessage(`✅ Renamed **${oldName}** → **${newName}**`);
    }
}
