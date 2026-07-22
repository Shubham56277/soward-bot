import { VoiceChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Guild } from "@repo/db";

export default class TowForSeven extends Command {
    constructor() {
        super({
            name: '247',
            description: {
                content: 'enable or disable 24/7 mode for the current channel',
                examples: ['247'],
                usage: '247',
            },
            category: 'music',
            aliases: ['24/7'],
            cooldown: 5,
            args: false,
            vote: false,
            premium: true,
            player: {
                voice: true,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        let player = ctx.client.manager.getPlayer(ctx.guild!.id);
        const memberVoiceChannel = (ctx.member as any).voice.channel as VoiceChannel;
        if (!memberVoiceChannel) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "You are not in a voice channel",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }
        if (!player) {
            player = ctx.client.manager.createPlayer({
                guildId: ctx.guild!.id,
                voiceChannelId: memberVoiceChannel.id,
                textChannelId: ctx.channel.id,
                selfMute: false,
                selfDeaf: true,
                vcRegion: memberVoiceChannel.rtcRegion!,
            });
            if (!player.connected) await player.connect();
        }

        const data = await Guild.get(ctx.guild!.id);
        if (data && data.twoFourSeven?.channelId) {
            await Guild.update(ctx.guild!.id, {
                twoFourSeven: null,
            });
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "Successfully disabled 24/7 mode",
                        color: ctx.client.config.colors.main,
                    },
                ],
            });
        }
        await Guild.update(ctx.guild!.id, {
            twoFourSeven: {
                channelId: memberVoiceChannel.id,
            },
        });
        return await ctx.sendMessage({
            embeds: [
                {
                    description: "Successfully enabled 24/7 mode",
                    color: ctx.client.config.colors.main,
                },
            ],
        });
    }
}
