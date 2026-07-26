import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, SectionBuilder, ThumbnailBuilder, GuildMember, Role } from "discord.js";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class RoleIconCommand extends Command {
    constructor() {
        super({
            name: "roleicon",
            description: {
                content: "Set a role's icon",
                examples: [
                    "roleicon @role <emoji>",
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
                components: [buildPanel(
                    "Insufficient Server Boosts",
                    "This server needs to be at least **level 2 boosted** to set role icons.\n\n" +
                    `**Current Boost Level:** Level ${ctx.guild.premiumTier}\n` +
                    "**Required Boost Level:** Level 2 (15+ boosts)"
                )],
                flags: MessageFlags.IsComponentsV2,
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
                const section = new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Role Icon Updated**\nSuccessfully set ${role}'s icon using the provided URL`))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription(`${role.name} icon`));
                return ctx.sendMessage({
                    components: [new ContainerBuilder().addSectionComponents(section)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            const customEmojiMatch = icon.match(/<?(a)?:?(\w{2,32}):(\d{17,19})>?/);
            if (customEmojiMatch) {
                const emojiId = customEmojiMatch[3];
                const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${customEmojiMatch[1] ? "gif" : "png"}`;
                await role.setIcon(emojiUrl);
                const section = new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Role Icon Updated**\nSuccessfully set ${role}'s icon using the emoji ${icon}`))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(emojiUrl).setDescription(`${role.name} icon`));
                return ctx.sendMessage({
                    components: [new ContainerBuilder().addSectionComponents(section)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            const unicodeEmojiMatch = icon.match(/\p{Emoji}/u);
            if (unicodeEmojiMatch) {
                await role.setIcon(icon);
                return ctx.sendMessage({
                    components: [buildPanel("Role Icon Updated", `Successfully set ${role}'s icon using the emoji ${icon}`)],
                    flags: MessageFlags.IsComponentsV2,
                });
            }

            return ctx.sendMessage("Please provide a valid emoji or image URL.");

        } catch (error) {
            console.error(error);
            return ctx.sendMessage({
                components: [buildPanel(
                    "Error Setting Role Icon",
                    "An error occurred while trying to set the role icon. Please ensure:\n\n" +
                    "**Valid Input:** You provided a valid emoji or image URL\n" +
                    "**Image Requirements:** Image must be under 256KB and in JPEG, PNG, or GIF format\n" +
                    "**Role Position:** The role must be below my highest role"
                )],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    }
}
