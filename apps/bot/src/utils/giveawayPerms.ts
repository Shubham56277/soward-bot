import { GuildMember, PermissionFlagsBits } from "discord.js";
import { Guild } from "@repo/db";

export async function hasGiveawayPerms(member: GuildMember | null | undefined, guildId: string): Promise<boolean> {
    if (!member) return false;
    // Admins always have access
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    // ManageGuild also grants access
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

    const guild = await Guild.get(guildId);
    // Check configured giveaway manager role
    if (guild.giveawaysManagerRole) {
        if (member.roles.cache.has(guild.giveawaysManagerRole)) return true;
    }
    return false;
}
