import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";

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
        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle(`${ctx.guild.name}'s Member Count`)
            .addFields([
                { name: 'Total Members', value: `${ctx.guild.memberCount}` },
                { name: 'Humans', value: `${ctx.guild.members.cache.filter(m => !m.user.bot).size}` },
                { name: 'Bots', value: `${ctx.guild.members.cache.filter(m => m.user.bot).size}` }
            ]);

        return ctx.sendMessage({ embeds: [embed] });
    }
}