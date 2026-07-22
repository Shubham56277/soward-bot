import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Volume extends Command {
    constructor() {
        super({
            name: 'volume',
            description: {
                content: 'Sets the volume',
                examples: ['volume 100'],
                usage: 'volume <number>',
            },
            category: 'music',
            aliases: ['v', 'vol'],
            cooldown: 5,
            args: true,
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
            options: [
                {
                    name: 'number',
                    description: 'Enter a number between 0 and 200',
                    type: 4,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        const embed = new EmbedBuilder();
        const number = Number(ctx.options.getInteger('number'));
        if (!player) return await ctx.sendMessage("Player is not connected");
        if (Number.isNaN(number) || number < 0 || number > 200) {
            let description = '';
            if (Number.isNaN(number)) description = "Please enter a valid number";
            else if (number < 0) description = "Please enter a number greater than 0";
            else if (number > 200) description = "Please enter a number less than 200";

            return await ctx.sendMessage({
                embeds: [embed.setColor(ctx.client.config.colors.red).setDescription(description)],
            });
        }

        await player.setVolume(number);
        const currentVolume = player.volume;

        return await ctx.sendMessage({
            embeds: [
                embed.setColor(ctx.client.config.colors.main).setDescription(
                    `Volume has been set to ${currentVolume}%`,
                ),
            ],
        });
    }
}
