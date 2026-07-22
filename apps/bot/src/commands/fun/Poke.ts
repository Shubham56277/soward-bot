import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Poke extends Command {
    constructor() {
        super({
            name: 'poke',
            description: {
                content: 'Poke someone',
                examples: ['poke @user'],
                usage: 'poke <user>',
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
                description: 'The user to poke',
                type: 6,
                required: true,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user');
        const { body } = await request('https://api.some-random-api.com/animu/poke');
        const data = await body.json() as { link: string };
        
        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setDescription(`${ctx.author} pokes ${user}!`)
            .setImage(data.link);

        return ctx.sendMessage({ embeds: [embed] });
    }
}