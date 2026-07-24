import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Cry extends Command {
    constructor() {
        super({
            name: 'cry',
            description: {
                content: 'Cry dramatically',
                examples: ['cry'],
                usage: 'cry',
            },
            category: 'fun',
            aliases: ['sob', 'tears'],
            cooldown: 5,
            args: false,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const dramaLevel = Math.floor(Math.random() * 101);
        
        const { body } = await request('https://api.some-random-api.com/animu/cry');
        const data = await body.json() as { link: string };

        let message: string;
        if (dramaLevel < 30) message = "A single tear falls...";
        else if (dramaLevel < 70) message = "Full on sobbing!";
        else message = "OSCAR-WORTHY DRAMA! 🎭";

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setDescription(`${ctx.author} is crying! ${message}`)
            .setImage(data.link)
            .setFooter({ text: `Drama Level: ${dramaLevel}%` });

        return ctx.sendMessage({ embeds: [embed] });
    }
}