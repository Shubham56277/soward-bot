import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { request } from "undici";

interface FactResponse {
    id: string;
    text: string;
    source: string;
    source_url: string;
    language: string;
    permalink: string;
}

export default class Fact extends Command {
    constructor() {
        super({
            name: "fact",
            description: {
                content: "Get a random fun fact",
                examples: ["fact"],
                usage: "fact",
            },
            category: "fun",
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        try {
            const { body } = await request("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
            const data = await body.json() as FactResponse;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Random Fact**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(data.text))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Source: ${data.source}`));

            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error("Fact Error:", error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to fetch a fact. Try again later."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
