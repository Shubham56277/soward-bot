import { GuildMember, PermissionFlagsBits } from "discord.js";
import { Guild } from "@repo/db";
import { env } from "@repo/env";

export async function hasGiveawayPerms(member: GuildMember | null | undefined, guildId: string): Promise<boolean> {
    if (!member) return false;
    // Developers always have access
    if (env.DEVELOPER_IDS.includes(member.id)) return true;
    // Admins always have access
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    // ManageGuild also grants access
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

    const guild = await Guild.get(guildId);
    // Check configured giveaway manager (user ID or role ID)
    if (guild.giveawaysManagerRole) {
        // Check if it's the user's ID directly
        if (member.id === guild.giveawaysManagerRole) return true;
        // Also check if it's a role they have
        if (member.roles.cache.has(guild.giveawaysManagerRole)) return true;
    }
    return false;
}
