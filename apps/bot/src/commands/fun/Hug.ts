import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Hug extends Command {
    constructor() {
        super({
            name: 'hug',
            description: {
                content: 'Show a hug GIF',
                examples: ['hug', 'hug @user'],
                usage: 'hug [user]',
            },
            category: 'fun',
            cooldown: 5,
            args: false,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [{
                name: 'user',
                description: 'The user to hug with',
                type: 6,
                required: false,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user') || ctx.author;
        const { body } = await request('https://api.some-random-api.com/animu/hug');
        const data = await body.json() as { link: string };
        
        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setDescription(`${ctx.author} is hugging ${user?.id !== ctx.author?.id ? `with ${user}` : 'self'}!`)
            .setImage(data.link);

        return ctx.sendMessage({ embeds: [embed] });
    }
}