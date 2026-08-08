import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class ServerSplashCommand extends Command {
    constructor() {
        super({
            name: "serversplash",
            description: {
                content: "Get the server splash image",
                examples: ["serversplash"],
                usage: "serversplash",
            },
            category: "utils",
            cooldown: 5,
            args: false,
            permissions: { dev: false, client: ["SendMessages"], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const splash = ctx.guild.splashURL({ size: 4096, extension: "png" });
        if (!splash) return ctx.sendMessage("This server has no splash image.");

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(splash),
        );

        return ctx.sendMessage({ content: `**${ctx.guild.name}** splash:\n${splash}`, components: [row], allowedMentions: { parse: [] } });
    }
}
