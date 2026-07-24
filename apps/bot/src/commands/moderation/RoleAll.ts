import { EmbedBuilder, Role, ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, PermissionResolvable } from "discord.js";
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
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setDescription("This role has dangerous permissions and cannot be mass assigned");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (role.position >= (ctx.guild.members.me?.roles.highest.position || Number.POSITIVE_INFINITY)) {
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setDescription("I cannot assign roles higher than my highest role");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (role.managed) {
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setDescription("This role is managed by an integration and cannot be assigned");
            return await ctx.sendMessage({ embeds: [embed] });
        }

        // Confirmation
        const confirmEmbed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle("Confirm Role Assignment")
            .setDescription(`This will add ${role} to all ${filterType === "all" ? "members" : filterType} in the server.`)
            .addFields(
                { name: "Safety Check", value: "✓ No dangerous permissions\n✓ Role position verified", inline: true }
            )
            .setFooter({ text: "This action cannot be undone automatically" });

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

        const confirmMsg = await ctx.sendMessage({
            embeds: [confirmEmbed],
            components: [actionRow]
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
                    const progressEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle("Role Assignment In Progress")
                        .setDescription(
                            `Adding ${role} to ${memberArray.length} members...\n\n` +
                            `Progress: 0/${memberArray.length}\n` +
                            `Estimated time: ${memberArray.length} seconds`
                        )
                        .setFooter({ text: "Processing with 1s delay between members" });

                    await confirmMsg.edit({ embeds: [progressEmbed], components: [] });

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
                            progressEmbed.setDescription(
                                `Adding ${role} to members...\n\n` +
                                `Progress: ${processed + errors}/${memberArray.length}\n` +
                                `Assigned: ${processed} | Errors: ${errors} | Skipped: ${skipped}\n` +
                                `Elapsed: ${elapsed}s | Remaining: ~${remaining}s`
                            );
                            await confirmMsg.edit({ embeds: [progressEmbed] });
                        }

                        // 1s delay between each member
                        await this.delay(1000);
                    }

                    // Final result
                    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                    const resultEmbed = new EmbedBuilder()
                        .setColor(errors > 0 ? Colors.Orange : Colors.Green)
                        .setTitle("Role Assignment Complete")
                        .setDescription(
                            `Results for ${role} assignment:\n\n` +
                            `<:Tick:1375519268292264012> Successfully added: ${processed}\n` +
                            `⚠️ Already had role: ${skipped}\n` +
                            `<:Cross:1375519752746958858> Failed assignments: ${errors}\n` +
                            `⏱️ Time taken: ${totalTime} seconds`
                        )
                        .setFooter({ text: "Processed with 1s delay between members" });

                    await confirmMsg.edit({ embeds: [resultEmbed] });

                } catch (error) {
                    console.error("Role assignment error:", error);
                    const errorEmbed = new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle("Error During Role Assignment")
                        .setDescription("An unexpected error occurred during the process");
                    await confirmMsg.edit({ embeds: [errorEmbed] });
                }

            } else if (interaction.customId === "cancel") {
                await interaction.deferUpdate();
                confirmEmbed
                    .setColor(0x000000)
                    .setTitle("Operation Cancelled");
                await confirmMsg.edit({
                    embeds: [confirmEmbed],
                    components: []
                });
                collector.stop();
            }
        });

        collector.on('end', () => {
            if (!confirmMsg.editable) return;
            confirmMsg.edit({ components: [] }).catch(() => { });
        });
    }
}
