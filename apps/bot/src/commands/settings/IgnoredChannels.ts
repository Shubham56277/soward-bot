import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ContainerBuilder,
    MessageFlags,
    RoleSelectMenuBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    UserSelectMenuBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { db, eq, IgnoredChannel, schema } from "@repo/db";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class IgnoredChannels extends Command {
    constructor() {
        super({
            name: "ignoredchannels",
            description: {
                content: "Manage channels where commands are ignored",
                examples: ["ignoredchannels"],
                usage: "ignoredchannels",
            },
            category: "settings",
            aliases: ["ignorechannel", "ic"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: [
                    "SendMessages",
                    "ReadMessageHistory",
                    "ViewChannel",
                    "EmbedLinks",
                ],
                user: ["ManageGuild"],
            },			slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const mainPanel = buildPanel("Ignored Channels Management",
            "Select an action to manage ignored channels. These are channels where bot commands are disabled.");

        // Create action row with buttons
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("ic_add_remove")
                .setLabel("Add/Remove Channel")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("ic_add_role")
                .setLabel("Add Exception Role")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("ic_add_user")
                .setLabel("Add Exception User")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("ic_clear")
                .setLabel("Clear All")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("ic_list")
                .setLabel("View List")
                .setStyle(ButtonStyle.Success),
        );

        // Send the initial message
        const message = await ctx.sendMessage({
            components: [mainPanel, row],
            flags: MessageFlags.IsComponentsV2,
        });

        // Collect button interactions
        const collector = message.createMessageComponentCollector({
            time: 600000,
        });

        collector.on("collect", async (interaction) => {
            if (!interaction.isButton()) return;
            if (interaction.user.id !== ctx.author?.id) {
                return interaction.reply({
                    content: "This is not your interaction!",
                    flags: MessageFlags.Ephemeral,
                });
            }

            try {
                switch (interaction.customId) {
                    case "ic_add_remove":
                        await this.handleAddRemove(ctx, interaction);
                        break;
                    case "ic_add_role":
                        await this.handleAddRole(ctx, interaction);
                        break;
                    case "ic_add_user":
                        await this.handleAddUser(ctx, interaction);
                        break;
                    case "ic_clear":
                        await this.handleClear(ctx, interaction);
                        break;
                    case "ic_list":
                        await this.handleList(ctx, interaction);
                        break;
                }
            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content: "An error occurred while processing your request.",
                    flags: MessageFlags.Ephemeral,
                });
            }
        });

        collector.on("end", () => {
            message?.edit({ components: [] }).catch(() => {});
        });
    }

    private async handleAddRemove(
        ctx: Context,
        interaction: ButtonInteraction,
    ) {
        const addRemovePanel = buildPanel("Add/Remove Ignored Channel", "Select a channel to add or remove from the ignored list.");

        const selectMenu = new ChannelSelectMenuBuilder()
            .setCustomId("ic_channel_select")
            .setPlaceholder("Select a channel")
            .setMaxValues(1);

        const row = new ActionRowBuilder<ChannelSelectMenuBuilder>()
            .addComponents(selectMenu);

        await interaction.reply({
            components: [addRemovePanel, row],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === ctx.author?.id &&
                i.customId === "ic_channel_select",
            time: 60000,
        });

        collector.on("collect", async (selectInteraction) => {
            if (!selectInteraction.isChannelSelectMenu()) return;

            const channelId = selectInteraction.values[0];
            if (!channelId) {
                await selectInteraction.reply({
                    content: "Please select a channel.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const existing = await IgnoredChannel.get(ctx.guild.id, channelId);

            if (existing) {
                await IgnoredChannel.delete(ctx.guild.id, channelId);
                await selectInteraction.reply({
                    content:
                        `Channel <#${channelId}> has been removed from the ignored list.`,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await IgnoredChannel.create({
                    guildId: ctx.guild.id,
                    channelId: channelId,
                });
                await selectInteraction.reply({
                    content:
                        `Channel <#${channelId}> has been added to the ignored list.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            collector.stop();
        });
    }

    private async handleAddRole(ctx: Context, interaction: ButtonInteraction) {
        const addRolePanel = buildPanel("Add Role Exception",
            "Select a channel to add role exceptions to, or select a role to add as exception.");

        // First get all ignored channels in this guild
        const ignoredChannels = await db
            .select()
            .from(schema.ignoredChannels)
            .where(eq(schema.ignoredChannels.guildId, ctx.guild.id))
            .execute();

        if (ignoredChannels.length === 0) {
            return interaction.reply({
                content:
                    "There are no ignored channels in this server. Add some first!",
                flags: MessageFlags.Ephemeral,
            });
        }

        // Create channel select menu
        const channelSelect = new StringSelectMenuBuilder()
            .setCustomId("ic_role_channel_select")
            .setPlaceholder("Select a channel")
            .addOptions(ignoredChannels.map((ch) => ({
                label: ctx.guild.channels.cache.get(ch.channelId)?.name ||
                    `Channel ${ch.channelId}`,
                value: ch.channelId,
            })));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(channelSelect);

        await interaction.reply({
            components: [addRolePanel, row],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === ctx.author?.id &&
                i.customId === "ic_role_channel_select",
            time: 60000,
        });

        collector.on("collect", async (selectInteraction) => {
            if (!selectInteraction.isStringSelectMenu()) return;

            const channelId = selectInteraction.values[0];
            if (!channelId) {
                await selectInteraction.reply({
                    content: "Please select a channel.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const channel = ignoredChannels.find((c) =>
                c.channelId === channelId
            );

            // Now show role select menu
            const rolePanel = buildPanel("Add Role Exception",
                `Select roles that can bypass the command block in <#${channelId}>`);

            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId("ic_role_select")
                .setPlaceholder("Select roles")
                .setMaxValues(25);

            const roleRow = new ActionRowBuilder<RoleSelectMenuBuilder>()
                .addComponents(roleSelect);

            await selectInteraction.update({
                components: [rolePanel, roleRow],
            });
            const roleMessage = await selectInteraction.fetchReply();
            const roleCollector = roleMessage.createMessageComponentCollector({
                    filter: (i) =>
                        i.user.id === ctx.author?.id &&
                        i.customId === "ic_role_select",
                    time: 60000,
                });

            roleCollector.on("collect", async (roleInteraction) => {
                if (!roleInteraction.isRoleSelectMenu()) return;

                const roleIds = roleInteraction.values;
                const currentRoles = channel?.unignoreRoles || [];
                const newRoles = [...new Set([...currentRoles, ...roleIds])];

                await IgnoredChannel.update(ctx.guild.id, channelId, {
                    unignoreRoles: newRoles,
                });

                await roleInteraction.reply({
                    content:
                        `Added ${roleIds.length} role(s) as exceptions for <#${channelId}>`,
                    flags: MessageFlags.Ephemeral,
                });

                roleCollector.stop();
                collector.stop();
            });
        });
    }

    private async handleAddUser(ctx: Context, interaction: ButtonInteraction) {
        const addUserPanel = buildPanel("Add User Exception",
            "Select a channel to add user exceptions to, or select users to add as exceptions.");

        // First get all ignored channels in this guild
        const ignoredChannels = await db
            .select()
            .from(schema.ignoredChannels)
            .where(eq(schema.ignoredChannels.guildId, ctx.guild.id))
            .execute();

        if (ignoredChannels.length === 0) {
            return interaction.reply({
                content:
                    "There are no ignored channels in this server. Add some first!",
                flags: MessageFlags.Ephemeral,
            });
        }

        // Create channel select menu
        const channelSelect = new StringSelectMenuBuilder()
            .setCustomId("ic_user_channel_select")
            .setPlaceholder("Select a channel")
            .addOptions(ignoredChannels.map((ch) => ({
                label: ctx.guild.channels.cache.get(ch.channelId)?.name ||
                    `Channel ${ch.channelId}`,
                value: ch.channelId,
            })));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(channelSelect);

        await interaction.reply({
            components: [addUserPanel, row],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === ctx.author?.id &&
                i.customId === "ic_user_channel_select",
            time: 60000,
        });

        collector.on("collect", async (selectInteraction) => {
            if (!selectInteraction.isStringSelectMenu()) return;

            const channelId = selectInteraction.values[0];
            if (!channelId) {
                await selectInteraction.reply({
                    content: "Please select a channel.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const channel = ignoredChannels.find((c) =>
                c.channelId === channelId
            );

            // Now show user select menu
            const userPanel = buildPanel("Add User Exception",
                `Select users that can bypass the command block in <#${channelId}>`);

            const userSelect = new UserSelectMenuBuilder()
                .setCustomId("ic_user_select")
                .setPlaceholder("Select users")
                .setMaxValues(25);

            const userRow = new ActionRowBuilder<UserSelectMenuBuilder>()
                .addComponents(userSelect);

            await selectInteraction.update({
                components: [userPanel, userRow],
            });
            const userMessage = await selectInteraction.fetchReply();
            const userCollector = userMessage.createMessageComponentCollector({
                    filter: (i) =>
                        i.user.id === ctx.author?.id &&
                        i.customId === "ic_user_select",
                    time: 60000,
                });

            userCollector.on("collect", async (userInteraction) => {
                if (!userInteraction.isUserSelectMenu()) return;

                const userIds = userInteraction.values;
                const currentUsers = channel?.unignoreUsers || [];
                const newUsers = [...new Set([...currentUsers, ...userIds])];

                await IgnoredChannel.update(ctx.guild.id, channelId, {
                    unignoreUsers: newUsers,
                });

                await userInteraction.reply({
                    content:
                        `Added ${userIds.length} user(s) as exceptions for <#${channelId}>`,
                    flags: MessageFlags.Ephemeral,
                });

                userCollector.stop();
                collector.stop();
            });
        });
    }

    private async handleClear(ctx: Context, interaction: ButtonInteraction) {
        const clearPanel = buildPanel("Clear All Ignored Channels",
            "Are you sure you want to clear all ignored channels and their exceptions?");

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("ic_confirm_clear")
                .setLabel("Confirm Clear")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("ic_cancel_clear")
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
            components: [clearPanel, row],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === ctx.author?.id &&
                (i.customId === "ic_confirm_clear" ||
                    i.customId === "ic_cancel_clear"),
            time: 60000,
        });

        collector.on("collect", async (btnInteraction) => {
            if (!btnInteraction.isButton()) return;

            if (btnInteraction.customId === "ic_confirm_clear") {
                await db
                    .delete(schema.ignoredChannels)
                    .where(eq(schema.ignoredChannels.guildId, ctx.guild.id))
                    .execute();

                await btnInteraction.reply({
                    content:
                        "All ignored channels and their exceptions have been cleared.",
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await btnInteraction.reply({
                    content: "Clear operation cancelled.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            collector.stop();
        });
    }

    private async handleList(ctx: Context, interaction: ButtonInteraction) {
        const ignoredChannels = await db
            .select()
            .from(schema.ignoredChannels)
            .where(eq(schema.ignoredChannels.guildId, ctx.guild.id))
            .execute();

        if (ignoredChannels.length === 0) {
            return interaction.reply({
                content: "There are no ignored channels in this server.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const listLines: string[] = ["Here are all channels where commands are disabled:", ""];

        for (const channel of ignoredChannels) {
            const channelName =
                ctx.guild.channels.cache.get(channel.channelId)?.toString() ||
                `Deleted Channel (${channel.channelId})`;

            let exceptions = "";
            if (channel.unignoreRoles?.length) {
                exceptions += `**Roles:** ${
                    channel.unignoreRoles.map((r) => `<@&${r}>`).join(", ")
                }\n`;
            }
            if (channel.unignoreUsers?.length) {
                exceptions += `**Users:** ${
                    channel.unignoreUsers.map((u) => `<@${u}>`).join(", ")
                }`;
            }

            listLines.push(`**${channelName}:** ${exceptions || "No exceptions"}`);
        }

        await interaction.reply({
            components: [buildPanel("Ignored Channels List", listLines.join("\n"))],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    }
}
