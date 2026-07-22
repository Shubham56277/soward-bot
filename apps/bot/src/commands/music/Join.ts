import { EmbedBuilder, VoiceChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";


export default class Join extends Command {
    constructor() {
        super({
            name: 'join',
            description: {
                content: 'Join a voice channel',
                examples: ['join'],
                usage: 'join',
            },
            category: 'music',
            aliases: ['summon', 'j', 'connect'],
            cooldown: 5,
            args: false,
            vote: false,
            player: {
                voice: true,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const embed = new EmbedBuilder().setAuthor({
            name: ctx.author?.username || "Unknown",
            iconURL: ctx.author?.displayAvatarURL(),
        })
        let player = ctx.client.manager.getPlayer(ctx.guild!.id);

        if (player) {
            return await ctx.editOrReply({
                embeds: [
                    embed.setColor(ctx.client.config.colors.main).setDescription(`Player is already connected in <#${player.voiceChannelId}>`),
                ],
            });
        }

        const memberVoiceChannel = (ctx.member as any).voice.channel as VoiceChannel;
        if (!memberVoiceChannel) {
            return await ctx.editOrReply({
                embeds: [embed.setColor(ctx.client.config.colors.red).setDescription("You are not in a voice channel")],
            });
        }

        player = ctx.client.manager.createPlayer({
            guildId: ctx.guild!.id,
            voiceChannelId: memberVoiceChannel.id,
            textChannelId: ctx.channel.id,
            selfMute: false,
            selfDeaf: true,
            vcRegion: memberVoiceChannel.rtcRegion!,
        });
        if (!player.connected) await player.connect();
        return await ctx.editOrReply({
            embeds: [
                embed.setColor(ctx.client.config.colors.main).setDescription(
                    `Successfully joined <#${player.voiceChannelId}>`,
                ),
            ],
        });
    }
}
