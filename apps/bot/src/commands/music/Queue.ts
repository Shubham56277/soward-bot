import { EmbedBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Pagination } from "../../utils/Pagination";
import { TimeFormat } from "../../utils/timeFormat";


export default class Queue extends Command {
    constructor() {
        super({
            name: 'queue',
            description: {
                content: 'View the current music queue',
                examples: ['queue'],
                usage: 'queue',
            },
            category: 'music',
            aliases: ['q'],
            cooldown: 5,
            args: false,
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
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const player = ctx.client.manager.getPlayer(ctx.guild!.id);
        if (!player) {
            return await ctx.sendMessage({
                embeds: [
                    {
                        description: "No music is currently playing",
                        color: ctx.client.config.colors.red,
                    },
                ],
            });
        }

        // Handle case when only current track is playing
        if (player.queue.current && player.queue.tracks.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(ctx.client.config.colors.main)
                .setDescription(
                    `**Now Playing**\n[${player.queue.current.info.title}](${player.queue.current.info.uri}) ` +
                    `- <@${(player.queue.current.requester as any).id}>\n` +
                    `Duration: ${player.queue.current.info.isStream ? '🔴 LIVE' : TimeFormat.toDotted(player.queue.current.info.duration)}`
                );

            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Prepare pages for queue
        const tracksPerPage = 10;
        const embedPages: EmbedBuilder[] = [];
        const totalTracks = player.queue.tracks.length;

        // Add current track as first item
        const allTracks = [player.queue.current, ...player.queue.tracks];

        // Create pages
        for (let i = 0; i < allTracks.length; i += tracksPerPage) {
            const pageTracks = allTracks.slice(i, i + tracksPerPage);

            const embed = new EmbedBuilder()
                .setColor(ctx.client.config.colors.main)
                .setAuthor({
                    name: `Queue for ${ctx.guild.name}`,
                    iconURL: ctx.guild.iconURL() ?? ctx.author?.displayAvatarURL(),
                })
                .setDescription(
                    pageTracks.map((track, index) => {
                        const pos = i + index;
                        if (pos === 0) {
                            return `**Now Playing**\n[${track?.info.title}](${track?.info.uri}) ` +
                                `- <@${track?.requester?.id ?? "unknown"}>\n` +
                                `Duration: ${track?.info.isStream ? '🔴 LIVE' : TimeFormat.toDotted(track?.info.duration)}`;
                        }
                        return `${pos}. [${track?.info.title}](${track?.info.uri}) ` +
                            `- <@${track?.requester?.id ?? "unknown"}>\n` +
                            `Duration: ${track?.info.isStream ? '🔴 LIVE' : TimeFormat.toDotted(track?.info.duration)}`;
                    }).join('\n\n')
                )
                .setFooter({ text: `Total ${totalTracks + 1} tracks in queue` });

            embedPages.push(embed);
        }

        // Handle case when there's only one page
        if (embedPages.length === 1) {
            return await ctx.sendMessage({ embeds: [embedPages[0]!] });
        }

        // Use pagination for multiple pages
        const pagination = new Pagination(ctx, embedPages);
        await pagination.start();
    }
}
