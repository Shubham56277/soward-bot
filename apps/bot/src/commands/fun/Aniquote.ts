import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";
import { request } from 'undici';

export default class AnimeQuote extends Command {
    constructor() {
        super({
            name: 'aniquote',
            description: {
                content: 'Get a random anime quote',
                examples: ['aniquote'],
                usage: 'aniquote',
            },
            category: 'fun',
            aliases: ['quote', 'animequote'],
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
        const { body } = await request('https://api.some-random-api.com/animu/quote');
        const data = await body.json() as { sentence: string, character: string, anime: string };

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('Random Anime Quote')
            .setDescription(`"${data.sentence}"`)
            .addFields(
                { name: 'Character', value: data.character, inline: true },
                { name: 'Anime', value: data.anime, inline: true }
            )
            .setFooter({ text: 'Powered by Some Random API' });

        return ctx.sendMessage({ embeds: [embed] });
    }
}