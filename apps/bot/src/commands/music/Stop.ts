import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Stop extends Command {
    constructor() {
        super({
            name: 'stop',
            description: {
                content: 'Stop the music',
                examples: ['stop'],
                usage: 'stop',
            },
            category: 'music',
            aliases: ['st'],
            cooldown: 5,
            args: false,
            vote: true,
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
        if (!player) return await ctx.sendMessage("Player is not connected");

        player.stopPlaying(true, false);

        const embed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle("Music Stopped")
            .setDescription("The music has been stopped and the queue has been cleared.")
            .setTimestamp();

        return await ctx.sendMessage({ embeds: [embed] });
    }
}
