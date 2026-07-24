import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { request } from "undici";

interface MemeResponse {
    title: string;
    url: string;
    subreddit: string;
    author: string;
    ups: number;
    nsfw: boolean;
}

export default class Meme extends Command {
    constructor() {
        super({
            name: "meme",
            description: {
                content: "Get a random meme",
                examples: ["meme"],
                usage: "meme",
            },
            category: "fun",
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["SendMessages", "EmbedLinks", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        try {
            const { body } = await request("https://meme-api.com/gimme");
            const data = await body.json() as MemeResponse;

            if (data.nsfw) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent("The fetched meme was marked NSFW. Try again!"));
                return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Memes require image display — use EmbedBuilder for image content
            const embed = new EmbedBuilder()
                .setTitle(data.title)
                .setImage(data.url)
                .setFooter({ text: `r/${data.subreddit} • 👍 ${data.ups}` });

            return ctx.sendMessage({ embeds: [embed] });
        } catch (error) {
            console.error("Meme Error:", error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to fetch a meme. Try again later."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
