import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Nom extends Command {
    constructor() {
        super({
            name: 'nom',
            description: {
                content: 'Nom nom someone!',
                examples: ['nom @user'],
                usage: 'nom <user>',
            },
            category: 'fun',
            aliases: ['bite', 'eat'],
            cooldown: 5,
            args: true,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [{
                name: 'user',
                description: 'The user to nom',
                type: 6,
                required: true,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user');
        const hungerLevel = Math.floor(Math.random() * 101);
        
        const { body } = await request('https://api.some-random-api.com/animu/nom');
        const data = await body.json() as { link: string };

        let message: string;
        if (hungerLevel < 40) message = "Gentle nibble 🦷";
        else if (hungerLevel < 80) message = "Big chomp! 🦖";
        else message = "DEVOURED WHOLE! 🍖";

        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setDescription(`${ctx.author} noms ${user}! ${message}`)
            .setImage(data.link)
            .setFooter({ text: `Hunger Level: ${hungerLevel}%` });

        return ctx.sendMessage({ embeds: [embed] });
    }
}