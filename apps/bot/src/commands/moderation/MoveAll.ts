import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType, ChannelType, VoiceChannel } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class MoveAll extends Command {
    constructor() {
        super({
            name: "moveall",
            description: {
                content: "Move all members from one voice channel to another",
                examples: ["moveall #general-voice #meeting-voice"],
                usage: "moveall <from_channel> <to_channel>",
            },
            category: "moderation",
            cooldown: 10,
            args: true,
            permissions: {
                dev: false,
                client: ["MoveMembers", "SendMessages", "ViewChannel"],
                user: ["MoveMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "from",
                    description: "The voice channel to move members from",
                    type: ApplicationCommandOptionType.Channel,
                    required: true,
                    channel_types: [ChannelType.GuildVoice],
                },
                {
                    name: "to",
                    description: "The voice channel to move members to",
                    type: ApplicationCommandOptionType.Channel,
                    required: true,
                    channel_types: [ChannelType.GuildVoice],
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const fromChannel = ctx.options.getChannel("from", true, 0) as VoiceChannel | null;
        const toChannel = ctx.options.getChannel("to", true, 1) as VoiceChannel | null;

        if (!fromChannel || fromChannel.type !== ChannelType.GuildVoice) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a valid source voice channel."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!toChannel || toChannel.type !== ChannelType.GuildVoice) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a valid destination voice channel."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (fromChannel.id === toChannel.id) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Source and destination channels must be different."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const members = fromChannel.members;

        if (members.size === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`No members are in ${fromChannel.toString()}.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let moved = 0;
        for (const [, member] of members) {
            try {
                await member.voice.setChannel(toChannel);
                moved++;
            } catch {
                // Skip members who can't be moved
            }
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Move Complete**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `Moved **${moved}** member${moved !== 1 ? "s" : ""} from ${fromChannel.toString()} → ${toChannel.toString()}`
            ));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
