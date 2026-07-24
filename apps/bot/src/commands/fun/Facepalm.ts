import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class Facepalm extends Command {
    constructor() {
        super({
            name: 'facepalm',
            description: {
                content: 'Facepalm at something dumb',
                examples: ['facepalm'],
                usage: 'facepalm',
            },
            category: 'fun',
            aliases: ['palm'],
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
        const facepalmPower = Math.floor(Math.random() * 101);
        
        const { body } = await request('https://api.some-random-api.com/animu/face-palm');
        const data = await body.json() as { link: string };

        let message: string;
        if (facepalmPower < 40) message = "Mild disappointment 🤦";
        else if (facepalmPower < 80) message = "Why am I not surprised?";
        else message = "BRAIN CELLS LOST FOREVER!";

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setDescription(`${ctx.author} facepalms! ${message}`)
            .setImage(data.link)
            .setFooter({ text: `Facepalm Power: ${facepalmPower}%` });

        return ctx.sendMessage({ embeds: [embed] });
    }
}