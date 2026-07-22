import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Wink extends Command {
    constructor() {
        super({
            name: 'wink',
            description: {
                content: 'Wink at someone',
                examples: ['wink @user'],
                usage: 'wink <user>',
            },
            category: 'fun',
            cooldown: 5,
            args: true,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [{
                name: 'user',
                description: 'The user to wink at',
                type: 6,
                required: true,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user');
        const { body } = await request('https://api.some-random-api.com/animu/wink');
        const data = await body.json() as { link: string };
        
        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setDescription(`${ctx.author} winks at ${user}!`)
            .setImage(data.link);

        return ctx.sendMessage({ embeds: [embed] });
    }
}