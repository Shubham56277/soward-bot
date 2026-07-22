import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Resume extends Command {
    constructor() {
        super({
            name: 'resume',
            description: {
                content: 'Resume the current paused track',
                examples: ['resume'],
                usage: 'resume',
            },
            category: 'music',
            aliases: ['r'],
            cooldown: 5,
            args: false,
            vote: false,
            player: {
                voice: true,
                active: true,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "Player is not connected",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        if (!player.paused) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The player is not paused",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.resume();

        const embed = new EmbedBuilder()
            .setDescription("Resumed the current track")
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
