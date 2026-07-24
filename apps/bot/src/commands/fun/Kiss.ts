import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Kiss extends Command {
    constructor() {
        super({
            name: 'kiss',
            description: {
                content: 'Kiss someone with a love meter',
                examples: ['kiss @user'],
                usage: 'kiss <user>',
            },
            category: 'fun',
            aliases: ['smooch'],
            cooldown: 5,
            args: true,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [{
                name: 'user',
                description: 'The user to kiss',
                type: 6,
                required: true,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user');
        const lovePercentage = Math.floor(Math.random() * 101);
        
        const { body } = await request('https://api.some-random-api.com/animu/kiss');
        const data = await body.json() as { link: string };

        let message: string;
        if (lovePercentage < 30) message = "A shy little peck 💋";
        else if (lovePercentage < 70) message = "Passionate kiss 😘";
        else message = "SOULMATES! 💞";

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setDescription(`${ctx.author} kisses ${user}! ${message}`)
            .setImage(data.link)
            .setFooter({ text: `Love Meter: ${lovePercentage}% compatible` });

        return ctx.sendMessage({ embeds: [embed] });
    }
}