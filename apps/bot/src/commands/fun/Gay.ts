import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder } from "discord.js";

export default class Gay extends Command {
    constructor() {
        super({
            name: 'gay',
            description: {
                content: 'Shows how gay someone is with a rainbow overlay',
                examples: ['gay', 'gay @user'],
                usage: 'gay [user]',
            },
            category: 'fun',
            aliases: ['rainbow', 'lgbtq'],
            cooldown: 5,
            args: false,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [{
                name: 'user',
                description: 'The user to check',
                type: 6,
                required: false,
            }],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user') || ctx.author;
        const gayPercentage = Math.floor(Math.random() * 101); // 0-100%
        const avatar = user?.displayAvatarURL({ extension: 'png', size: 1024 });
        
        // Different messages based on percentage
        let message: string;
        if (gayPercentage < 20) message = "Just a little bit fruity 🍇";
        else if (gayPercentage < 40) message = "Exploring their options 🧐";
        else if (gayPercentage < 60) message = "Definitely not straight 🏳️‍🌈";
        else if (gayPercentage < 80) message = "Super gay! 🌈✨";
        else message = "ULTRA GAY POWER! 💥🏳️‍⚧️";

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle(`Gay Meter for ${user?.username}`)
            .setDescription(`${message}\n**Gay Percentage:** ${gayPercentage}% gay!`)
            .setImage(`https://some-random-api.com/canvas/gay?avatar=${avatar}`)
            .setFooter({ text: 'This is just for fun, no actual metrics are measured' });

        return ctx.sendMessage({ embeds: [embed] });
    }
}