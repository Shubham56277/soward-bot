import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from "discord.js";

export default class ServerIcon extends Command {
    constructor() {
        super({
            name: "servericon",
            description: {
                content: "Shows the server icon",
                examples: ["servericon"],
                usage: "servericon",
            },
            category: 'utils',
            aliases: ["icon", "serveravatar"],
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
        const icon = ctx.guild.iconURL({ size: 4096 });
        if (!icon) return ctx.sendMessage("This server has no icon.");

        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle(`${ctx.guild.name}'s Icon`)
            .setImage(icon);
        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Download")
                    .setURL(icon)
                    .setStyle(ButtonStyle.Link),
            );
        return ctx.sendMessage({ embeds: [embed], components: [button] });
    }
}
