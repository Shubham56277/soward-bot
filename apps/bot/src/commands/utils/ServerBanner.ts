import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from "discord.js";

export default class ServerBanner extends Command {
    constructor() {
        super({
            name: "serverbanner",
            description: {
                content: "Shows the server banner",
                examples: ["serverbanner"],
                usage: "serverbanner",
            },
            category: 'utils',
            aliases: ["banner"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
                user: [],
            },			slashCommand: false,
			options: []
        });
    }

    public async run(ctx: Context): Promise<any> {
        const banner = ctx.guild.bannerURL({ size: 4096 });
        if (!banner) return ctx.sendMessage("This server has no banner.");

        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle(`${ctx.guild.name}'s Banner`)
            .setImage(banner);

        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Download")
                    .setURL(banner)
                    .setStyle(ButtonStyle.Link),
            );
        return ctx.sendMessage({ embeds: [embed], components: [button] });
    }
}
