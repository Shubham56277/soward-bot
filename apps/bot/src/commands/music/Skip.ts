import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";


export default class Skip extends Command {
    constructor() {
        super({
            name: 'skip',
            description: {
                content: 'Skip current song',
                examples: ['skip'],
                usage: 'skip',
            },
            category: 'music',
            aliases: ['sk'],
            cooldown: 5,
            args: false,
            vote: true,
            player: {
                voice: true,
                active: true
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
        const embed = new EmbedBuilder();
        if (!player) return await ctx.sendMessage("Player is not connected");
        const autoplay = player.get<boolean>('autoplay');
        if (!autoplay && player.queue.tracks.length === 0) {
            return await ctx.sendMessage({
                embeds: [embed.setColor(ctx.client.config.colors.red).setDescription("Queue is empty")],
            });
        }
        const currentTrack = player.queue.current?.info;
        player.skip(0, !autoplay);
        if (ctx.isInteraction) {
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(ctx.client.config.colors.main).setDescription(`Skipped [${currentTrack?.title}](${currentTrack?.uri})`),
                ],
            });
        }
        ctx.message?.react('👍');
    }
}
