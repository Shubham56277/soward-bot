import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerPagination } from "../../utils/Pagination";
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

        // Handle case when only current track is playing
        if (player.queue.current && player.queue.tracks.length === 0) {
            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**Now Playing**\n[${player.queue.current.info.title}](${player.queue.current.info.uri}) ` +
                    `- <@${(player.queue.current.requester as any).id}>\n` +
                    `Duration: ${player.queue.current.info.isStream ? 'LIVE' : TimeFormat.toDotted(player.queue.current.info.duration)}`
                )
            );

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Prepare pages for queue
        const tracksPerPage = 10;
        const containerPages: ContainerBuilder[] = [];
        const totalTracks = player.queue.tracks.length;

        // Add current track as first item
        const allTracks = [player.queue.current, ...player.queue.tracks];

        // Create pages
        for (let i = 0; i < allTracks.length; i += tracksPerPage) {
            const pageTracks = allTracks.slice(i, i + tracksPerPage);

            const description = pageTracks.map((track, index) => {
                const pos = i + index;
                if (pos === 0) {
                    return `**Now Playing**\n[${track?.info.title}](${track?.info.uri}) ` +
                        `- <@${track?.requester?.id ?? "unknown"}>\n` +
                        `Duration: ${track?.info.isStream ? 'LIVE' : TimeFormat.toDotted(track?.info.duration)}`;
                }
                return `${pos}. [${track?.info.title}](${track?.info.uri}) ` +
                    `- <@${track?.requester?.id ?? "unknown"}>\n` +
                    `Duration: ${track?.info.isStream ? 'LIVE' : TimeFormat.toDotted(track?.info.duration)}`;
            }).join('\n\n');

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Queue for ${ctx.guild.name}**`))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Total ${totalTracks + 1} tracks in queue`));

            containerPages.push(container);
        }

        // Handle case when there's only one page
        if (containerPages.length === 1) {
            return await ctx.sendMessage({ components: [containerPages[0]!], flags: MessageFlags.IsComponentsV2 });
        }

        // Use pagination for multiple pages
        const pagination = new ContainerPagination(ctx, containerPages);
        await pagination.start();
    }
}
