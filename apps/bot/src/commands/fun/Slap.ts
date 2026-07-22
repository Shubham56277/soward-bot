import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder, User } from "discord.js";
import { request } from 'undici';


export default class Slap extends Command {
    constructor() {
        super({
            name: 'slap',
            description: {
                content: 'Slap someone with anime style!',
                examples: ['slap @user', 'slap @user -power 100'],
                usage: 'slap <user> [-power (1-100)]',
            },
            category: 'fun',
            aliases: ['smack', 'hit'],
            cooldown: 5,
            args: true,
            permissions: {
                client: ['SendMessages', 'EmbedLinks'],
            },
            slashCommand: false,
            options: [
                {
                    name: 'user',
                    description: 'User to slap',
                    type: 6,
                    required: true
                },
                {
                    name: 'power',
                    description: 'Slap power (1-100)',
                    type: 4,
                    required: false,
                    min_value: 1,
                    max_value: 100
                }
            ],
        });
    }

    private getSlapStrength(power: number): string {
        const strengths = [
            { emoji: '👋', text: '**Gentle tap**', threshold: 20 },
            { emoji: '✋', text: '**Medium slap**', threshold: 40 },
            { emoji: '👊', text: '**Strong slap**', threshold: 60 },
            { emoji: '🔥', text: '**BRUTAL SLAP**', threshold: 80 },
            { emoji: '💥', text: '**ATOMIC SLAP!**', threshold: 100 }
        ];

        return strengths.find(s => power <= s.threshold)?.text || '**👋 Gentle tap**';
    }

    private getSlapResult(victim: User, power: number): string {
        const results = [
            `${victim} is seeing stars! ✨`,
            `${victim} went flying! 🚀`,
            "The sound echoed for miles! 📢",
            `${victim} is now orbiting Earth! 🛰️`,
            `Critical hit! ${victim} is rethinking life choices! 🤔`,
            "SLAPPED into next week! 📅",
            `${victim}'s ancestors felt that! 👻`
        ];
    
        const weightedResults = [
            ...results,
            ...(power > 80 ? results : []),
            ...(power > 90 ? results : [])
        ];
    
        if (weightedResults.length === 0) {
            return 'No slap result available'; // or some other default value
        }
    
        return weightedResults[Number(getRandomInt(0, weightedResults.length - 1))] || 'No slap result available';
    }

    public async run(ctx: Context): Promise<any> {
        const user = ctx.options.getUser('user') || ctx.message?.mentions.users.first();
        if (!user) {
            return ctx.sendMessage('Please specify a user to slap.');
        }
    
        let power = getRandomInt(1, 100);
    
        if (ctx.isInteraction) {
            const slashPower = ctx.options.getInteger('power');
            if (typeof slashPower === 'number') {
                power = Math.min(100, Math.max(1, slashPower));
            }
        }
    
        if (!ctx.isInteraction && ctx.args[1]?.toLowerCase() === '-power' && ctx.args[2]) {
            const parsed = Number.parseInt(ctx.args[2], 10);
            if (!Number.isNaN(parsed)) {
                power = Math.min(100, Math.max(1, parsed));
            }
        }
    
        try {
            const { body } = await request('https://api.waifu.pics/sfw/slap');
            const { url } = await body.json() as { url: string };
    
            const embed = new EmbedBuilder()
                .setColor('#FF5555')
                .setAuthor({ 
                    name: `${ctx.author?.username} slaps ${user?.username}!`, 
                    iconURL: ctx.author?.displayAvatarURL() 
                })
                .setDescription(`
                    ${this.getSlapStrength(power)}
                    ${this.getSlapResult(user, power)}
                `)
                .setImage(url)
                .addFields({
                    name: 'Slap Stats',
                    value: `**Power:** ${power}%\n**Damage:** ${(power * 3).toFixed(0)} HP`,
                    inline: true,
                })
                .setFooter({
                    text: power > 90
                        ? '🚑 Medical attention might be needed...'
                        : 'They probably deserved it...'
                });
    
            return ctx.sendMessage({ embeds: [embed] });
        } catch (error) {
            console.error('Slap command error:', error);
            return ctx.sendMessage(
                `**${ctx.author?.username} slaps ${user.username} with ${power}% power!**\n${this.getSlapResult(user, power)}\n${this.getSlapStrength(power)}`
            );
        }
    }    
}

function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
