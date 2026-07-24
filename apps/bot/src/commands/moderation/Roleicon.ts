import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { EmbedBuilder, GuildMember, Role } from "discord.js";

export default class RoleIconCommand extends Command {
    constructor() {
        super({
            name: "roleicon",
            description: {
                content: "Set a role's icon",
                examples: [
                    "roleicon @role 🎮",
                    "roleicon @role :emoji:",
                    "roleicon @role https://example.com/image.png"
                ],
                usage: "roleicon <role> <emoji|url>"
            },
            category: "moderation",
            aliases: ["setroleicon"],
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["ManageRoles"],
                user: ["ManageRoles"],
            },
            slashCommand: false,
            options: [
                {
                    name: "role",
                    description: "The role to set the icon for",
                    type: 8,
                    required: true
                },
                {
                    name: "icon",
                    description: "The emoji or image URL to set as the role icon",
                    type: 3,
                    required: true
                }
            ]
        });
    }

    public async run(ctx: Context): Promise<any> {
        const role = ctx.options.getRole("role") as Role;
        const icon = ctx.options.getString("icon", true, 1)!;

        // Check if the server has sufficient boosts (level 2 or higher)
        if (ctx.guild.premiumTier < 2) {
            return ctx.sendMessage({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle("Insufficient Server Boosts")
                        .setDescription("This server needs to be at least **level 2 boosted** to set role icons.")
                        .addFields(
                            { name: "Current Boost Level", value: `Level ${ctx.guild.premiumTier}` },
                            { name: "Required Boost Level", value: "Level 2 (15+ boosts)" }
                        )
                ]
            });
        }

        if (role.position >= ctx.guild.members.me!.roles.highest.position) {
            return ctx.sendMessage("I can't manage that role because it's higher than or equal to my highest role.");
        }

        if (role.position >= (ctx.member as GuildMember).roles.highest.position) {
            return ctx.sendMessage("You can't manage that role because it's higher than or equal to your highest role.");
        }

        try {
            // Check if the input is a URL
            if (icon.match(/^https?:\/\/.+\..+$/)) {
                await role.setIcon(icon);
                return ctx.sendMessage({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(role.color)
                            .setTitle("Role Icon Updated")
                            .setDescription(`Successfully set ${role}'s icon using the provided URL`)
                            .setThumbnail(icon)
                    ]
                });
            }

            const customEmojiMatch = icon.match(/<?(a)?:?(\w{2,32}):(\d{17,19})>?/);
            if (customEmojiMatch) {
                const emojiId = customEmojiMatch[3];
                await role.setIcon(`https://cdn.discordapp.com/emojis/${emojiId}.${customEmojiMatch[1] ? "gif" : "png"}`);
                return ctx.sendMessage({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(role.color)
                            .setTitle("Role Icon Updated")
                            .setDescription(`Successfully set ${role}'s icon using the emoji ${icon}`)
                            .setThumbnail(`https://cdn.discordapp.com/emojis/${emojiId}.${customEmojiMatch[1] ? "gif" : "png"}`)
                    ]
                });
            }

            const unicodeEmojiMatch = icon.match(/\p{Emoji}/u);
            if (unicodeEmojiMatch) {
                await role.setIcon(icon);
                return ctx.sendMessage({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(role.color)
                            .setTitle("Role Icon Updated")
                            .setDescription(`Successfully set ${role}'s icon using the emoji ${icon}`)
                    ]
                });
            }

            return ctx.sendMessage("Please provide a valid emoji or image URL.");

        } catch (error) {
            console.error(error);
            return ctx.sendMessage({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x000000)
                        .setTitle("Error Setting Role Icon")
                        .setDescription("An error occurred while trying to set the role icon. Please ensure:")
                        .addFields(
                            { name: "Valid Input", value: "You provided a valid emoji or image URL" },
                            { name: "Image Requirements", value: "Image must be under 256KB and in JPEG, PNG, or GIF format" },
                            { name: "Role Position", value: "The role must be below my highest role" }
                        )
                ]
            });
        }
    }
}
