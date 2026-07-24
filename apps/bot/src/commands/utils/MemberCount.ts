import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

export default class MemberCount extends Command {
    constructor() {
        super({
            name: 'membercount',
            description: {
                content: 'Shows the server member count',
                examples: ['membercount'],
                usage: 'membercount',
            },
            category: 'utils',
            aliases: ['members', "mc"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const panel = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                [
                    `## ${ctx.guild.name}'s Member Count`,
                    `**Total Members:** ${ctx.guild.memberCount}`,
                    `**Humans:** ${ctx.guild.members.cache.filter(m => !m.user.bot).size}`,
                    `**Bots:** ${ctx.guild.members.cache.filter(m => m.user.bot).size}`,
                ].join("\n")
            ));

        return ctx.sendMessage({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
}