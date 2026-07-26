import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Loop extends Command {
    constructor() {
        super({
            name: 'loop',
            description: {
                content: 'Set the loop mode (off, song, or queue)',
                examples: ['loop off', 'loop queue', 'loop song'],
                usage: 'loop [mode]',
            },
            category: 'music',
            aliases: ['lp'],
            cooldown: 5,
            args: true,
            vote: false,
            player: {
                voice: true,
                active: true,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [
                {
                    name: 'mode',
                    description: 'The loop mode to set',
                    type: 3,
                    required: false,
                    choices: [
                        {
                            name: 'Off',
                            value: 'off',
                        },
                        {
                            name: 'Song',
                            value: 'song',
                        },
                        {
                            name: 'Queue',
                            value: 'queue',
                        },
                    ],
                },
            ],
        });
    }

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage(this.msg("No music is currently playing"));
        }

        let loopMessage = '';


        const mode = ctx.options?.getString('mode')?.toLowerCase() ||
            ctx.args?.[0]?.toLowerCase();

        if (mode) {
            switch (mode) {
                case 'song':
                case 'track':
                case 's':
                    player.setRepeatMode('track');
                    loopMessage = "Looping the current song";
                    break;
                case 'queue':
                case 'q':
                    player.setRepeatMode('queue');
                    loopMessage = "Looping the entire queue";
                    break;
                case 'off':
                case 'o':
                    player.setRepeatMode('off');
                    loopMessage = "Loop disabled";
                    break;
                default:
                    loopMessage = "Invalid loop mode. Use `off`, `song`, or `queue`";
            }
        } else {
            // Cycle through modes if no argument provided
            switch (player.repeatMode) {
                case 'off':
                    player.setRepeatMode('track');
                    loopMessage = "Looping the current song";
                    break;
                case 'track':
                    player.setRepeatMode('queue');
                    loopMessage = "Looping the entire queue";
                    break;
                case 'queue':
                    player.setRepeatMode('off');
                    loopMessage = "Loop disabled";
                    break;
            }
        }

        return await ctx.sendMessage(this.msg(loopMessage));
    }
}
