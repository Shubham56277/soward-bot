import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Replay extends Command {
    constructor() {
        super({
            name: 'replay',
            description: {
                content: 'Replay the current track from the beginning',
                examples: ['replay'],
                usage: 'replay',
            },
            category: 'music',
            aliases: ['rp'],
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
                        description: "No music is currently playing",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        const currentTrack = player.queue.current;
        if (!currentTrack?.info.isSeekable) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "The current track cannot be replayed",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        player.seek(0);

        const embed = new EmbedBuilder()
            .setDescription("🔁 Replaying the current track from the beginning")
            .setColor(ctx.client.config.colors.main);

        await ctx.sendMessage({ embeds: [embed] });
    }
}
