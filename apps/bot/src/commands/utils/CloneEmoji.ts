import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class CloneEmojiCommand extends Command {
    constructor() {
        super({
            name: "cloneemoji",
            description: {
                content: "Clone an emoji from another server (via URL or emoji)",
                examples: ["cloneemoji :emoji:"],
                usage: "cloneemoji <emoji>",
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
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const input = ctx.args[0];
        if (!input) return ctx.sendMessage("Provide an emoji to clone.");

        const match = input.match(/<(a?):(\w+):(\d+)>/);
        if (!match) return ctx.sendMessage("Provide a valid custom emoji.");

        const animated = match[1] === "a";
        const name = match[2]!;
        const id = match[3]!;
        const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;

        try {
            const emoji = await ctx.guild.emojis.create({ attachment: url, name, reason: `Cloned by ${ctx.author?.username}` });
            return ctx.sendMessage(`✅ Cloned emoji **${emoji.name}** ${emoji.toString()}`);
        } catch (e: any) {
            return ctx.sendMessage(`Failed to clone emoji: ${e.message ?? "Unknown error"}`);
        }
    }
}
