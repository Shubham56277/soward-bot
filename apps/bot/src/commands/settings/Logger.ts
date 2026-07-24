import { AuditLogger } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
} from "discord.js";

/** Build a Components V2 panel */
function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class Logger extends Command {
    selected: string[] = [];
    channelId: string | null = null;

    constructor() {
        super({
            name: "logger",
            description: {
                content: "Manage the logger",
                examples: ["logger"],
                usage: "logger",
            },
            category: "settings",
            aliases: ["log"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
                user: ["Administrator"],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const logger = await AuditLogger.get(ctx.guild.id);
        const loggerTypes = {
            "member_update": "Member Update",
            "role_update": "Role Update",
            "channel_update": "Channel Update",
            "guild_update": "Guild Update",
            "ban_create": "Ban Create",
            "ban_delete": "Ban Delete",
            "member_kick": "Member Kick",
            "member_prune": "Member Prune",
            "message_update": "Message Update",
            "emoji_update": "Emoji Update",
            "webhook_update": "Webhook Update",
            "sticker_update": "Sticker Update",
            "member_join": "Member Join",
            "member_leave": "Member Leave",
        };

        const filter = (i: any) => {
            if (i.user.id === ctx.author?.id) return true;
            i.reply({
                embeds: [
                    {
                        color: ctx.client.config.colors.red,
                        description: "You are not allowed to use this button.",
                    },
                ],
                flags: MessageFlags.Ephemeral,
            });
            return false;
        };

        if (!logger) {
            return this.handleNewLogger(ctx, loggerTypes, filter);
        }
        return this.handleExistingLogger(ctx, logger, loggerTypes, filter);
    }

    private async handleNewLogger(ctx: Context, loggerTypes: Record<string, string>, filter: (i: any) => boolean): Promise<any> {
        const menu = new StringSelectMenuBuilder()
            .setCustomId("logger-menu")
            .setPlaceholder("Select the logger type")
            .setMinValues(1)
            .setOptions(
                Object.entries(loggerTypes).map(([value, label]) => ({
                    label,
                    value,
                    description: `Log when a ${label} event occurs`,
                }))
            )
            .setMaxValues(Object.keys(loggerTypes).length);

        const channelMenu = new ChannelSelectMenuBuilder()
            .setCustomId("logger-channel")
            .setPlaceholder("Select a channel")
            .setMinValues(1)
            .setChannelTypes([ChannelType.GuildText])
            .setMaxValues(1);

        const autoSetupButton = new ButtonBuilder()
            .setCustomId("logger-auto-setup")
            .setLabel("Auto Setup with Channels")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📂");

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(menu);
        const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().setComponents(channelMenu);
        const row3 = new ActionRowBuilder<ButtonBuilder>().setComponents(autoSetupButton);

        const setupBody = [
            "**Step 1:** Select which events you want to log",
            "**Step 2:** Choose the channel where logs will be sent",
            "",
            "✨ **New Features:**",
            "- Use **Auto Setup with Channels** for optimized logging setup with dedicated channels:",
            "  • Member events (joins, leaves, updates)",
            "  • Moderation events (bans, kicks)",
            "  • Guild events (roles, channels, server updates)",
            "  • Content events (messages, emojis, webhooks)",
            "- Each event type can be configured separately",
        ].join("\n");

        const embed = buildPanel("Audit Log Configuration", setupBody);

        const msg = await ctx.editOrReply({
            components: [embed, row, row2, row3],
            flags: MessageFlags.IsComponentsV2,
        });

        const collector = msg.createMessageComponentCollector({
            filter,
            time: 600000,
        });

        collector.on("collect", async (i) => {
            if (i.customId === "logger-menu" && i.isStringSelectMenu()) {
                this.selected = i.values;
                const updatedBody = [
                    `**Step 1:** <:Tick:1375519268292264012> Selected events: ${this.selected.map(type => loggerTypes[type as keyof typeof loggerTypes]).join(", ")}`,
                    "**Step 2:** Select a channel where logs will be sent",
                ].join("\n");
                await i.update({
                    components: [buildPanel("Audit Log Configuration", updatedBody), row, row2, row3],
                });
            } else if (i.customId === "logger-channel" && i.isChannelSelectMenu()) {
                const channelId = i.values[0]!;
                const channel = ctx.guild.channels.cache.get(channelId);

                if (!channel) {
                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.red,
                                description: "Channel not found.",
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                if (this.selected.length === 0) {
                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.orange,
                                description: "Please select at least one event type first.",
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                try {
                    await AuditLogger.update(ctx.guild.id, {
                        channelAndType: this.selected.map((type) => ({
                            channelId: channel.id,
                            type,
                        })),
                        enabled: true,
                    });

                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.main,
                                description: `Logger has been set up successfully for ${this.selected.length} event type(s) in ${channel}.`,
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                    collector.stop();
                } catch (_error) {
                    console.error(error);
                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.red,
                                description: "There was an error setting up the logger.",
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } else if (i.customId === "logger-auto-setup") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                let logsCategory = ctx.guild.channels.cache.find(c => c.name === "Server Logs" && c.type === ChannelType.GuildCategory);

                if (!logsCategory) {
                    try {
                        logsCategory = await ctx.guild.channels.create({
                            name: "Server Logs",
                            type: ChannelType.GuildCategory,
                            permissionOverwrites: [
                                {
                                    id: ctx.guild.id,
                                    deny: ["ViewChannel"],
                                },
                                {
                                    id: ctx.client.user!.id,
                                    allow: ["ViewChannel", "SendMessages", "EmbedLinks"],
                                }
                            ],
                        });
                    } catch (_error) {

                        await i.editReply({
                            embeds: [
                                {
                                    color: ctx.client.config.colors.red,
                                    description: "Failed to create logs category. Please ensure I have the correct permissions.",
                                },
                            ],
                        });
                        return;
                    }
                }

                // Define channel groups
                const channelGroups = {
                    member: {
                        name: "member-logs",
                        topic: "Member-related events",
                        events: ["member_update", "member_join", "member_leave"]
                    },
                    moderation: {
                        name: "mod-logs",
                        topic: "Moderation actions",
                        events: ["ban_create", "ban_delete", "member_kick", "member_prune"]
                    },
                    guild: {
                        name: "guild-logs",
                        topic: "Guild structure events",
                        events: ["role_update", "channel_update", "guild_update"]
                    },
                    content: {
                        name: "content-logs",
                        topic: "Content changes",
                        events: ["message_update", "emoji_update", "webhook_update", "sticker_update"]
                    }
                };

                const createdChannels: { [key: string]: any } = {};
                const channelAndTypeEntries = [];
                let setupError = false;

                // Create channels and assign events
                for (const [groupKey, group] of Object.entries(channelGroups)) {
                    // Check if channel already exists
                    let channel = ctx.guild.channels.cache.find(
                        c => c.name === group.name &&
                            c.type === ChannelType.GuildText &&
                            c.parentId === logsCategory.id
                    );

                    if (!channel) {
                        try {
                            channel = await ctx.guild.channels.create({
                                name: group.name,
                                type: ChannelType.GuildText,
                                parent: logsCategory.id,
                                topic: group.topic,
                                permissionOverwrites: [
                                    {
                                        id: ctx.guild.id,
                                        deny: ["ViewChannel"],
                                    },
                                    {
                                        id: ctx.client.user!.id,
                                        allow: ["ViewChannel", "SendMessages", "EmbedLinks"],
                                    }
                                ],
                            });
                        } catch (_error) {
                            setupError = true;
                            break;
                        }
                    }

                    createdChannels[groupKey] = channel;

                    // Add event types for this channel
                    for (const eventType of group.events) {
                        channelAndTypeEntries.push({
                            channelId: channel.id,
                            type: eventType
                        });
                    }
                }

                if (setupError) {
                    await i.editReply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.red,
                                description: "Failed to create one or more log channels. Please ensure I have the correct permissions.",
                            },
                        ],
                    });
                    return;
                }

                try {
                    await AuditLogger.update(ctx.guild.id, {
                        channelAndType: channelAndTypeEntries,
                        enabled: true,
                    });

                    const setupCompleteLines = Object.entries(channelGroups).map(([_key, group]) => {
                        const eventsText = group.events.map(type => `• ${loggerTypes[type as keyof typeof loggerTypes]}`).join("\n");
                        return `**📋 ${group.name}**\n${eventsText}`;
                    }).join("\n\n");

                    const autoSetupBody = [
                        `Successfully set up specialized log channels under the "Server Logs" category.`,
                        "",
                        setupCompleteLines,
                        "",
                        "-# You can customize these settings further with the Add/Remove Event options.",
                    ].join("\n");

                    await i.editReply({
                        components: [buildPanel("Logger Setup Complete", autoSetupBody)],
                    });
                    collector.stop();
                } catch (error) {
                    console.error(error);
                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.red,
                                description: "There was an error setting up the logger.",
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }
        });

        collector.on("end", async () => {
            await msg.edit({
                components: [
                    row.setComponents(menu.setDisabled(true)),
                    row2.setComponents(channelMenu.setDisabled(true)),
                    row3.setComponents(autoSetupButton.setDisabled(true))
                ],
            }).catch(() => { });
        });
    }

    private async handleExistingLogger(ctx: Context, logger: any, loggerTypes: Record<string, string>, filter: (i: any) => boolean): Promise<any> {
        // Group events by channel for better UI organization
        const eventsByChannel: Record<string, string[]> = {};

        logger.channelAndType.forEach((entry: any) => {
            if (!eventsByChannel[entry.channelId]) {
                eventsByChannel[entry.channelId] = [];
            }
            eventsByChannel[entry.channelId]!.push(entry.type);
        });

        const channelLines = Object.entries(eventsByChannel).map(([channelId, events]) => {
            const evtList = events.map(e => `  • ${loggerTypes[e as keyof typeof loggerTypes]}`).join("\n");
            return `**Channel <#${channelId}>**\n${evtList}`;
        }).join("\n\n");

        const embed = buildPanel("Logger Settings", `Current logger configuration:\n\n${channelLines}`);

        // Create buttons for actions
        const addButton = new ButtonBuilder()
            .setCustomId("logger-add")
            .setLabel("Add Event")
            .setStyle(ButtonStyle.Success)
            .setEmoji("➕");

        const removeButton = new ButtonBuilder()
            .setCustomId("logger-remove")
            .setLabel("Remove Event")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("➖");

        const resetButton = new ButtonBuilder()
            .setCustomId("logger-reset")
            .setLabel("Reset All")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄");

        const row = new ActionRowBuilder<ButtonBuilder>().setComponents(addButton, removeButton, resetButton);

        const msg = await ctx.editOrReply({
            components: [embed, row],
            flags: MessageFlags.IsComponentsV2,
        });

        const collector = msg.createMessageComponentCollector({
            filter,
            time: 600000,
        });

        collector.on("collect", async (i) => {
            if (i.customId === "logger-add") {
                // Show menu to add new event
                const availableEvents = Object.entries(loggerTypes).filter(([key]) => {
                    // Check if this event type is already configured across all channels
                    return !logger.channelAndType.some((entry: any) => entry.type === key);
                });

                if (availableEvents.length === 0) {
                    await i.reply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.orange,
                                description: "All event types are already configured. You can remove some first if you want to reconfigure them.",
                            },
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const eventMenu = new StringSelectMenuBuilder()
                    .setCustomId("logger-event-add")
                    .setPlaceholder("Select event type")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .setOptions(
                        availableEvents.map(([value, label]) => ({
                            label,
                            value,
                            description: `Log when a ${label} event occurs`,
                        }))
                    );

                const channelMenu = new ChannelSelectMenuBuilder()
                    .setCustomId("logger-channel-add")
                    .setPlaceholder("Select channel")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .setChannelTypes([ChannelType.GuildText]);

                const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(eventMenu);
                const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().setComponents(channelMenu);

                const addBody = "Select the event type and channel for the new logger entry:";

                await i.reply({
                    components: [buildPanel("Add Logger Event", addBody), eventRow, channelRow],
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                });

                const addCollector = i.channel!.createMessageComponentCollector({
                    filter: (interaction) => interaction.user.id === ctx.author?.id &&
                        (interaction.customId === "logger-event-add" ||
                            interaction.customId === "logger-channel-add"),
                    time: 60000,
                });

                let selectedEvent: string | null = null;
                let selectedChannel: string | null = null;

                addCollector.on("collect", async (interaction) => {
                    if (interaction.customId === "logger-event-add" && interaction.isStringSelectMenu()) {
                        selectedEvent = interaction.values[0]!;
                        await interaction.update({
                            components: [buildPanel("Add Logger Event", `Selected event: **${loggerTypes[selectedEvent as keyof typeof loggerTypes]}**\nNow select a channel:`), eventRow, channelRow],
                        });
                    } else if (interaction.customId === "logger-channel-add" && interaction.isChannelSelectMenu()) {
                        selectedChannel = interaction.values[0]!;

                        if (!selectedEvent) {
                            await interaction.update({
                                components: [buildPanel("Add Logger Event", "Please select an event type first!"), eventRow, channelRow],
                            });
                            return;
                        }

                        try {
                            // Add the new event-channel pair
                            await AuditLogger.addChannelAndType(ctx.guild.id, selectedChannel, selectedEvent);

                            addCollector.stop();
                            await interaction.update({
                                components: [buildPanel("Logger", `Successfully added **${loggerTypes[selectedEvent as keyof typeof loggerTypes]}** events to <#${selectedChannel}>.`)],
                            });

                            // Refresh the main menu
                            const updatedLogger = await AuditLogger.get(ctx.guild.id);
                            await this.handleExistingLogger(ctx, updatedLogger, loggerTypes, filter);
                        } catch (error) {
                            console.error(error);
                            await interaction.update({
                                components: [buildPanel("Logger — Error", "Failed to add the logger event.")],
                            });
                        }
                    }
                });

                addCollector.on("end", async (_collected, reason) => {
                    if (reason === "time") {
                        await i.editReply({
                            components: [buildPanel("Logger — Timed Out", "Operation timed out.")],
                        }).catch(() => { });
                    }
                });
            } else if (i.customId === "logger-remove") {
                // Show menu to remove existing event
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                if (logger.channelAndType.length === 0) {
                    await i.editReply({
                        embeds: [
                            {
                                color: ctx.client.config.colors.orange,
                                description: "There are no events configured to remove.",
                            },
                        ],
                    });
                    return;
                }

                const removeOptions = logger.channelAndType.map((entry: any) => ({
                    label: loggerTypes[entry.type as keyof typeof loggerTypes],
                    value: `${entry.channelId}:${entry.type}`,
                    description: `Remove from channel <#${entry.channelId}>`,
                }));

                const removeMenu = new StringSelectMenuBuilder()
                    .setCustomId("logger-remove-event")
                    .setPlaceholder("Select event to remove")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .setOptions(removeOptions);

                const removeRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(removeMenu);

                const removeBody = "Select the event you want to remove:";

                await i.editReply({
                    components: [buildPanel("Remove Logger Event", removeBody), removeRow],
                });

                const removeCollector = i.channel!.createMessageComponentCollector({
                    filter: (interaction) => interaction.user.id === ctx.author?.id &&
                        interaction.customId === "logger-remove-event",
                    time: 60000,
                });

                removeCollector.on("collect", async (interaction) => {
                    if (interaction.isStringSelectMenu()) {
                        const [channelId, eventType] = interaction.values[0]!.split(":");

                        try {
                            await AuditLogger.removeChannelAndType(ctx.guild.id, channelId!, eventType!);

                            removeCollector.stop();
                            await interaction.update({
                                components: [buildPanel("Logger", `Successfully removed **${loggerTypes[eventType as keyof typeof loggerTypes]}** events from <#${channelId}>.`)],
                            });

                            // Refresh the main menu
                            const updatedLogger = await AuditLogger.get(ctx.guild.id);
                            if (!updatedLogger || updatedLogger.channelAndType.length === 0) {
                                // If all events were removed, go back to new logger setup
                                await this.handleNewLogger(ctx, loggerTypes, filter);
                            } else {
                                await this.handleExistingLogger(ctx, updatedLogger, loggerTypes, filter);
                            }
                        } catch (_error) {
                            console.error(error);
                            await interaction.update({
                                components: [buildPanel("Logger — Error", "Failed to remove the logger event.")],
                            });
                        }
                    }
                });

                removeCollector.on("end", async (_collected, reason) => {
                    if (reason === "time") {
                        await i.editReply({
                            components: [buildPanel("Logger — Timed Out", "Operation timed out.")],
                        }).catch(() => { });
                    }
                });
            } else if (i.customId === "logger-reset") {
                // Confirm reset
                const confirmButton = new ButtonBuilder()
                    .setCustomId("logger-reset-confirm")
                    .setLabel("Yes, Reset All")
                    .setStyle(ButtonStyle.Danger);

                const cancelButton = new ButtonBuilder()
                    .setCustomId("logger-reset-cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary);

                const confirmRow = new ActionRowBuilder<ButtonBuilder>().setComponents(confirmButton, cancelButton);

                await i.reply({
                    components: [buildPanel("Reset Logger Configuration", "⚠️ Are you sure you want to reset all logger settings? This will remove all configured events."), confirmRow],
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                });

                const confirmCollector = i.channel!.createMessageComponentCollector({
                    filter: (interaction) => interaction.user.id === ctx.author?.id &&
                        (interaction.customId === "logger-reset-confirm" ||
                            interaction.customId === "logger-reset-cancel"),
                    time: 60000,
                });

                confirmCollector.on("collect", async (interaction) => {
                    if (interaction.customId === "logger-reset-confirm") {
                        try {
                            await AuditLogger.delete(ctx.guild.id);

                            confirmCollector.stop();
                            await interaction.update({
                                components: [buildPanel("Logger", "Successfully reset all logger settings.")],
                            });

                            // Go back to new logger setup
                            await this.handleNewLogger(ctx, loggerTypes, filter);
                        } catch (_error) {
                            console.error(error);
                            await interaction.update({
                                components: [buildPanel("Logger — Error", "Failed to reset logger settings.")],
                            });
                        }
                    } else if (interaction.customId === "logger-reset-cancel") {
                        confirmCollector.stop();
                        await interaction.update({
                            components: [buildPanel("Logger", "Reset operation cancelled.")],
                        });
                    }
                });

                confirmCollector.on("end", async (_collected, reason) => {
                    if (reason === "time") {
                        await i.editReply({
                            components: [buildPanel("Logger — Timed Out", "Operation timed out.")],
                        }).catch(() => { });
                    }
                });
            }
        });

        collector.on("end", async () => {
            await msg.edit({
                components: [
                    row.setComponents(
                        addButton.setDisabled(true),
                        removeButton.setDisabled(true),
                        resetButton.setDisabled(true)
                    )
                ],
            }).catch(() => { });
        });
    }
}
