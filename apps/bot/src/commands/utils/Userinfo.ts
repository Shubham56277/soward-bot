import { ContainerBuilder, GuildMember, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, UserFlagsString } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

function buildPanel(title: string, body: string): ContainerBuilder {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

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

        const lines = [
            ...basicInfo,
            "",
            `**Roles [${roles?.length}]:** ${rolesText.length > 1024 ? "Too many roles to display" : rolesText}`,
        ];

        if (badgesText !== "None") {
            lines.push(`**Badges:** ${badgesText}`);
        }

        if (member.roles.highest.id !== ctx.guild?.id) {
            lines.push(`**Highest Role:** ${member.roles.highest.toString()}`);
        }

        const permissions = member.permissions.toArray();
        if (permissions.length > 0) {
            lines.push(`**Key Permissions:** \`${member.permissions.has("Administrator") ? "Administrator" : permissions.slice(0, 5).join("`, `")}${permissions.length > 5 ? ` (+${permissions.length - 5} more)` : ""}\``);
        }

        if (member.voice.channel) {
            lines.push(`**Voice Channel:** ${member.voice.channel.toString()}`);
        }
        if (member.premiumSinceTimestamp) {
            lines.push(`**Boosting Since:** <t:${Math.floor(member.premiumSinceTimestamp! / 1000)}:R>`);
        }
        if (user.banner) {
            lines.push(`**Banner:** [View Banner](${user.bannerURL({ size: 4096 })})`);
        }
        if (user.accentColor) {
            lines.push(`**Accent Color:** \`#${user.accentColor.toString(16).padStart(6, '0')}\``);
        }
        if (user.avatarDecorationData) {
            lines.push(`**Avatar Decoration:** [View Decoration](${user.avatarDecorationURL({ size: 4096 })})`);
        }

        lines.push("", `-# Requested by ${ctx.author?.username}`);

        const panel = buildPanel(
            `${member?.user.username}${member?.user.bot ? " [BOT]" : ""}'s Info`,
            lines.join("\n"),
        );

        return ctx.editOrReply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
}