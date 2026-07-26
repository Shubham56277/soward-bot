import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, Role, ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, PermissionResolvable } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

// Dangerous permissions to check against
const dangerPermissions: PermissionResolvable[] = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.MentionEveryone,
    PermissionFlagsBits.ManageWebhooks,
];

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class RoleAll extends Command {
    constructor() {
        super({
            name: "roleall",
            description: {
                content: "Add a role to all server members (with 1s delay)",
                examples: ["roleall @Verified", "roleall 123456789012345678"],
                usage: "roleall <role> [bots/humans]",
            },
            category: "moderation",
            aliases: ["massrole", "addroleall"],
            cooldown: 30,
            args: true,
            permissions: {
                dev: false,
                client: ["ManageRoles"],
                user: ["Administrator"],
            },
            slashCommand: false,
            options: [
                {
                    name: "role",
                    description: "Role to add to all members",
                    type: ApplicationCommandOptionType.Role,
                    required: true,
                },
                {
                    name: "type",
                    description: "Target bot or human members",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: "Bots Only", value: "bots" },
                        { name: "Humans Only", value: "humans" }
                    ],
                }
            ],
        });
    }

    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private hasDangerousPermissions(role: Role): boolean {
        return dangerPermissions.some(perm => role.permissions.has(perm));
    }

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const role = ctx.options.getRole("role", true) as Role;
        const targetType = ctx.options.getString("type", false) || "humans";

        // Handle text command arguments
        let textType: string | null = null;
        if (!ctx.isInteraction) {
            const args = ctx.args;
            if (args[1]?.toLowerCase() === "bots") textType = "bots";
            if (args[1]?.toLowerCase() === "humans") textType = "humans";
        }

        const filterType = textType || targetType;

        // Safety checks
        if (this.hasDangerousPermissions(role)) {
            return await ctx.sendMessage(this.msg("This role has dangerous permissions and cannot be mass assigned"));
        }

        if (role.position >= (ctx.guild.members.me?.roles.highest.position || Number.POSITIVE_INFINITY)) {
            return await ctx.sendMessage(this.msg("I cannot assign roles higher than my highest role"));
        }

        if (role.managed) {
            return await ctx.sendMessage(this.msg("This role is managed by an integration and cannot be assigned"));
        }

        // Confirmation
        const confirmContainer = buildPanel(
            "Confirm Role Assignment",
            `This will add ${role} to all ${filterType === "all" ? "members" : filterType} in the server.\n\n` +
            "**Safety Check:** No dangerous permissions, role position verified\n\n" +
            "-# This action cannot be undone automatically"
        );

        const actionRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("confirm")
                    .setLabel("Confirm")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Danger)
            );

        let lastContainer: ContainerBuilder = confirmContainer;

        const confirmMsg = await ctx.sendMessage({
            components: [confirmContainer, actionRow],
            flags: MessageFlags.IsComponentsV2,
        });

        const collector = confirmMsg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async interaction => {
            if (interaction.customId === "confirm") {
                await interaction.deferUpdate();

                try {
                    // Fetch all members
                    const members = await ctx.guild.members.fetch();
                    const filteredMembers = members.filter(m => {
                        if (filterType === "bots") return m.user.bot;
                        if (filterType === "humans") return !m.user.bot;
                        return true;
                    });

                    const memberArray = Array.from(filteredMembers.values());
                    let processed = 0;
                    let skipped = 0;
                    let errors = 0;
                    const startTime = Date.now();

                    // Update with initial count
                    let progressBody =
                        `Adding ${role} to ${memberArray.length} members...\n\n` +
                        `Progress: 0/${memberArray.length}\n` +
                        `Estimated time: ${memberArray.length} seconds\n\n` +
                        "-# Processing with 1s delay between members";

                    lastContainer = buildPanel("Role Assignment In Progress", progressBody);
                    await confirmMsg.edit({ components: [lastContainer], flags: MessageFlags.IsComponentsV2 });

                    // Process each member with delay
                    for (const member of memberArray) {
                        try {
                            if (!member.roles.cache.has(role.id)) {
                                // Additional safety check for each member
                                if (!this.hasDangerousPermissions(role)) {
                                    await member.roles.add(role);
                                    processed++;
                                } else {
                                    skipped++;
                                }
                            } else {
                                skipped++;
                            }
                        } catch (error) {
                            errors++;
                            console.error(`Failed to add role to ${member.user.tag}:`, error);
                        }

                        // Update progress every 3 members or when complete
                        if ((processed + errors) % 3 === 0 || (processed + errors + skipped) === memberArray.length) {
                            const elapsed = Math.floor((Date.now() - startTime) / 1000);
                            const remaining = memberArray.length - processed - errors - skipped;
                            progressBody =
                                `Adding ${role} to members...\n\n` +
                                `Progress: ${processed + errors}/${memberArray.length}\n` +
                                `Assigned: ${processed} | Errors: ${errors} | Skipped: ${skipped}\n` +
                                `Elapsed: ${elapsed}s | Remaining: ~${remaining}s`;
                            lastContainer = buildPanel("Role Assignment In Progress", progressBody);
                            await confirmMsg.edit({ components: [lastContainer], flags: MessageFlags.IsComponentsV2 });
                        }

                        // 1s delay between each member
                        await this.delay(1000);
                    }

                    // Final result
                    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                    const resultBody =
                        `Results for ${role} assignment:\n\n` +
                        `Successfully added: ${processed}\n` +
                        `Already had role: ${skipped}\n` +
                        `Failed assignments: ${errors}\n` +
                        `Time taken: ${totalTime} seconds\n\n` +
                        "-# Processed with 1s delay between members";

                    lastContainer = buildPanel("Role Assignment Complete", resultBody);
                    await confirmMsg.edit({ components: [lastContainer], flags: MessageFlags.IsComponentsV2 });

                } catch (error) {
                    console.error("Role assignment error:", error);
                    lastContainer = buildPanel("Error During Role Assignment", "An unexpected error occurred during the process");
                    await confirmMsg.edit({
                        components: [lastContainer],
                        flags: MessageFlags.IsComponentsV2,
                    });
                }

            } else if (interaction.customId === "cancel") {
                await interaction.deferUpdate();
                lastContainer = buildPanel("Operation Cancelled", `This will add ${role} to all ${filterType === "all" ? "members" : filterType} in the server.`);
                await confirmMsg.edit({
                    components: [lastContainer],
                    flags: MessageFlags.IsComponentsV2,
                });
                collector.stop();
            }
        });

        collector.on('end', () => {
            if (!confirmMsg.editable) return;
            confirmMsg.edit({ components: [lastContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        });
    }
}
