import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import * as reply from "../../utils/reply";

export default class Pause extends Command {
    constructor() {
        super({
            name: 'pause',
            description: {
                content: 'Pause the current track',
                examples: ['pause'],
                usage: 'pause',
            },
            category: 'music',
            aliases: ['pu'],
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
            return reply.error(ctx, "Player is not connected");
        }

        if (player.paused) {
            return reply.error(ctx, "The player is already paused");
        }

        player.pause();
        return reply.success(ctx, "Paused the current track");
    }
}
