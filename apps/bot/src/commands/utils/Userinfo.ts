import { EmbedBuilder, GuildMember, UserFlagsString } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

const badges: Record<UserFlagsString, string> = {
    Staff: "Staff",
    ActiveDeveloper: "<:ActiveDeveloper:1367032636748464189>",
    Partner: "Partner",
    Hypesquad: "HypeSquad",
    BugHunterLevel1: "Bug Hunter Lv1",
    BugHunterLevel2: "Bug Hunter Lv2",
    HypeSquadOnlineHouse1: "<:HYPERSQUADBRAVERY:1367032259588132864>",
    HypeSquadOnlineHouse2: "<:hypersquadsbrilliance:1367033544064368651>",
    HypeSquadOnlineHouse3: "<:HYPERSQUADBALANCE:1367033577602027590>",
    PremiumEarlySupporter: "Early Supporter",
    TeamPseudoUser: "Team User",
    VerifiedBot: "Verified Bot",
    VerifiedDeveloper: "Verified Dev",
    CertifiedModerator: "Certified Mod",
    BotHTTPInteractions: "Bot",
    Spammer: "Spammer",
    Quarantined: "Quarantined",
    MFASMS: "2FA SMS",
    PremiumPromoDismissed: "Premium Promo Dismissed",
    HasUnreadUrgentMessages: "Unread Urgent Messages",
    DisablePremium: "Premium Disabled",
    Collaborator: "Collaborator",
    RestrictedCollaborator: "Restricted Collaborator",
};

export default class Userinfo extends Command {
    constructor() {
        super({
            name: 'userinfo',
            description: {
                content: 'Get information about a user',
                examples: ['userinfo @user'],
                usage: 'userinfo [user]',
            },
            category: 'utils',
            aliases: ['whois', 'user', "ui"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to get information about",
                    type: 6,
                    required: false
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        let member: GuildMember | undefined | null = ctx.member;
        if (!member) return ctx.editOrReply({
            embeds: [{
                color: ctx.client.config.colors.red,
                description: "Could not find the specified user.",
            }]
        });
        if (!ctx.isInteraction) {
            member = ctx.args[0] ?  ctx.message?.mentions.members?.first() || ctx.message?.guild?.members.cache.get(ctx.args[0]) : ctx.member;
        } else {
            member = ctx.interaction?.options.getMember("user") as GuildMember;
        }
        if (!member) member = ctx.member;
        if (!member) return ctx.editOrReply({
            embeds: [{
                color: ctx.client.config.colors.red,
                description: "Could not find the specified user.",
            }]
        });
        const user = await member?.user.fetch(true);
        const color = member?.displayHexColor === "#000000" ? "#2f3136" : member?.displayHexColor;

        // Process basic information
        const basicInfo = [
            `**ID:** (\`${member?.id}\`)`,
            `**Username:** \`${member?.user.username || "None"}\``,
            `**Bot:** \`${member?.user.bot ? "Yes" : "No"}\``,
            `**Status:** \`${member?.presence?.status || "Offline"}\``,
            `**Account Created:** <t:${Math.floor(member?.user.createdTimestamp! / 1000)}:R>`,
            `**Server Joined:** <t:${Math.floor(member?.joinedTimestamp! / 1000)}:R>`,
        ];

        // Process roles
        const roles = member?.roles.cache
            .filter(r => r.id !== ctx.guild?.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.toString());
        const rolesText = roles?.length! > 0 ? roles?.join(", ") : "None";

        // Process badges
        const userFlags = user?.flags?.toArray() || [];
        const badgesText = userFlags.length > 0
            ? userFlags.map(flag => badges[flag]).join(", ")
            : "None";

        // Build the embed
        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${member?.user.username} ${member?.user.bot ? "[BOT]" : ""}`,
                iconURL: member?.user.displayAvatarURL(),
            })
            .setThumbnail(member?.user.displayAvatarURL({ size: 4096 })!)
            .setColor(color!)
            .setDescription(basicInfo.join("\n"))
            .addFields(
                {
                    name: `Roles [${roles?.length}]`,
                    value: rolesText.length > 1024 ? "Too many roles to display" : rolesText
                }
            );

        // Add conditional fields
        if (badgesText !== "None") {
            embed.addFields({ name: "Badges", value: badgesText, inline: true });
        }

        if (member.roles.highest.id !== ctx.guild?.id) {
            embed.addFields({ name: "Highest Role", value: member.roles.highest.toString(), inline: true });
        }

        const permissions = member.permissions.toArray();
        if (permissions.length > 0) {
            embed.addFields({
                name: "Key Permissions",
                value: `\`${member.permissions.has("Administrator") ? "Administrator" : permissions.slice(0, 5).join("`, `")}${permissions.length > 5 ? ` (+${permissions.length - 5} more)` : ""}\``
            });
        }

        //Extra for voice chanel, or server boosting
        if (member.voice.channel) {
            embed.addFields({
                name: "Voice Channel",
                value: member.voice.channel.toString(),
                inline: true,
            });
        }
        if (member.premiumSinceTimestamp) {
            embed.addFields({
                name: "Boosting Since",
                value: `<t:${Math.floor(member.premiumSinceTimestamp! / 1000)}:R>`,
                inline: true
            });
        }
        // Add media fields
        if (user.banner) {
            embed.setImage(user.bannerURL({ size: 4096 })!);
        }

        if (user.accentColor) {
            embed.addFields({
                name: "Accent Color",
                value: `\`#${user.accentColor.toString(16).padStart(6, '0')}\``,
                inline: true
            });
        }

        if (user.avatarDecorationData) {
            embed.addFields({
                name: "Avatar Decoration",
                value: `[View Decoration](${user.avatarDecorationURL({ size: 4096 })})`,
                inline: true
            });
        }

        embed.setFooter({
            text: `Requested by ${ctx.author?.username}`,
            iconURL: ctx.author?.displayAvatarURL()
        }).setTimestamp();

        return ctx.editOrReply({ embeds: [embed] });
    }
}