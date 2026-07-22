import { ActionRowBuilder, ApplicationCommandOptionType, ApplicationCommandType, AttachmentBuilder, ButtonBuilder, ButtonStyle, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { UserContextMenuCommandInteraction } from "discord.js";


export default class Avater extends Command {
    constructor() {
        super({
            name: 'avatar',
            description: {
                content: 'Get the avatar of a user.',
                examples: ['avatar', 'avatar @user'],
                usage: 'avatar',
            },
            category: 'utils',
            context: {
                enabled: true,
                name: 'Avatar',
                type: ApplicationCommandType.User
            },
            aliases: ['av', "pfp"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [{
                name: 'user',
                description: 'The user to get the avatar of',
                type: ApplicationCommandOptionType.User,
                required: false
            }],
        });
    }
    public async run(ctx: Context): Promise<any> {
        const user = ctx.options?.getMember('user') as GuildMember || ctx.member as GuildMember;
        const globalAvatarUrl = user.user.displayAvatarURL({ size: 4096 });

        const avatarUrl = user.displayAvatarURL({ size: 4096 });

        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Download')
                    .setStyle(ButtonStyle.Link)
                    .setURL(globalAvatarUrl)
            );
        if (globalAvatarUrl !== avatarUrl) {
            button.addComponents(
                new ButtonBuilder()
                    .setLabel('Guild Avatar')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId('guild-avatar'),
            )
        }
        const media = new AttachmentBuilder(globalAvatarUrl)
            .setFile(globalAvatarUrl, 'avatar.png');

        const msg = await ctx.editOrReply({
            content: `-# Here is ${user}'s avatar`,
            components: [button],
            files: [media]
        });

        const filter = (i: any) => i.user.id === ctx.author?.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async i => {
            if (i.customId === 'guild-avatar') {
                const guildAvatarUrl = user.displayAvatarURL({ size: 4096 });
                const media = new AttachmentBuilder(guildAvatarUrl)
                    .setFile(guildAvatarUrl, 'avatar.png');
                await i.update({
                    content: `-# Here is ${user}'s guild avatar`,
                    components: [new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel('Download')
                                .setStyle(ButtonStyle.Link)
                                .setURL(guildAvatarUrl)
                        )],
                    files: [media]
                });
            }
        });
    }

    public async contextRun(ctx: UserContextMenuCommandInteraction<"cached">): Promise<any> {
        const user = ctx.guild.members.cache.get(ctx.targetId) as GuildMember;
        const globalAvatarUrl = user.user.displayAvatarURL({ size: 4096 });

        const avatarUrl = user.displayAvatarURL({ size: 4096 });

        const button = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Download')
                    .setStyle(ButtonStyle.Link)
                    .setURL(globalAvatarUrl)
            );
        if (globalAvatarUrl !== avatarUrl) {
            button.addComponents(
                new ButtonBuilder()
                    .setLabel('Guild Avatar')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId('guild-avatar'),
            )
        }
        const media = new AttachmentBuilder(globalAvatarUrl)
            .setFile(globalAvatarUrl, 'avatar.png');

        const msg = await ctx.reply({
            content: `-# Here is ${user}'s avatar`,
            components: [button],
            files: [media]
        });

        const filter = (i: any) => i.user.id === ctx.member?.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async i => {
            if (i.customId === 'guild-avatar') {
                const guildAvatarUrl = user.displayAvatarURL({ size: 4096 });
                const media = new AttachmentBuilder(guildAvatarUrl)
                    .setFile(guildAvatarUrl, 'avatar.png');
                await i.update({
                    content: `-# Here is ${user}'s guild avatar`,
                    components: [new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel('Download')
                                .setStyle(ButtonStyle.Link)
                                .setURL(guildAvatarUrl)
                        )],
                    files: [media]
                });
            }
        });
    }
}