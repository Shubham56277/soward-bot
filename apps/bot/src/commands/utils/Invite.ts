import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

export default class Invite extends Command {
    constructor() {
        super({
            name: "invite",
            description: {
                content: "Get the bot invite link",
                examples: ["invite"],
                usage: "invite",
            },
            category: 'utils',
            aliases: ["invitelink"],
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
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const panel = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Invite the Bot!\nAdd the bot to your server using the link below!"));

        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("invite")
                    .setURL(
                        `https://discord.com/oauth2/authorize?client_id=${ctx.client.user?.id}&permissions=8&scope=bot%20applications.commands`,
                    )
                    .setStyle(ButtonStyle.Link),
            );
        return ctx.sendMessage({ components: [panel, button], flags: MessageFlags.IsComponentsV2 });
    }
}
