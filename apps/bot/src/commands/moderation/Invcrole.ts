import { VoiceChannelRole } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { PermissionFlagsBits, PermissionResolvable, Role } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";


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
export default class VCRole extends Command {
    constructor() {
        super({
            name: "invcrole",
            description: {
                content: "Manage voice channel roles",
                examples: [
                    "invcrole add @Role",
                    "invcrole reset",
                ],
                usage: "invcrole <subcommand>",
            },
            category: "moderation",
            aliases: ["vcrole", "voicechannelrole"],
            cooldown: 10,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["ManageRoles"],
                user: ["ManageRoles"],
            },
            slashCommand: true,
            options: [
                {
                    name: "add",
                    description:
                        "Add a role to be assigned when joining voice channels",
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: "role",
                            description: "Role to add",
                            type: 8, // Role type
                            required: true,
                        },
                    ],
                },
                {
                    name: "reset",
                    description:
                        "Reset all voice channel roles for this server",
                    type: ApplicationCommandOptionType.Subcommand,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const subcommand = ctx.options.getSubCommand();

        switch (subcommand) {
            case "add":
                return this.addVCRole(ctx);
            case "reset":
                return this.resetVCRoles(ctx);
            default:
                return ctx.sendMessage(
                    "Invalid subcommand. Use: add, reset",
                );
        }
    }

    private hasDangerousPermissions(role: Role): boolean {
        return dangerPermissions.some(perm => role.permissions.has(perm));
    }
    private async addVCRole(ctx: Context): Promise<any> {
        const role = ctx.options.getRole("role", true, 1) as Role;

        if (this.hasDangerousPermissions(role) && ctx.author?.id !== ctx.guild.ownerId) {
            return ctx.sendMessage(
                "You cannot give a role with dangerous permissions",
            );
        }
        if (role.position >= ctx.guild!.members.me!.roles.highest.position) {
            return ctx.sendMessage(
                "I can't manage that role because it's higher than my highest role.",
            );
        }

        const existing = await VoiceChannelRole.get(ctx.guild.id!);
        if (existing) {
            return ctx.sendMessage(
                "This role is already configured as a invoice role.",
            );
        }

        await VoiceChannelRole.create({
            guildId: ctx.guild.id!,
            roleId: role.id,
        });

        return ctx.sendMessage(
            `Added ${role.toString()} as a invoice role.`,
        );
    }

    private async resetVCRoles(ctx: Context): Promise<any> {
        const roles = await VoiceChannelRole.get(ctx.guild.id!);
        if (!roles) {
            return ctx.sendMessage(
                "There are no invoice roles configured for this server.",
            );
        }

        await VoiceChannelRole.delete(ctx.guild.id!);
        return ctx.sendMessage(
            "Reset all invoice roles for this server.",
        );
    }
}
