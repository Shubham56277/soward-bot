import { IgnoredChannel } from "@repo/db";
import { Message } from "discord.js";

export async function isCommandIgnored(message: Message): Promise<boolean> {
    if (!message.guild || !message.channel.isTextBased()) return false;
    
    const ignoredChannel = await IgnoredChannel.get(message.guild.id, message.channel.id);
    if (!ignoredChannel) return false;

    // Check if user has bypass permission
    if (message.member) {
        const hasBypassRole = ignoredChannel.unignoreRoles?.some(roleId => 
            message.member!.roles.cache.has(roleId)
        );
        const hasBypassUser = ignoredChannel.unignoreUsers?.includes(message.author.id);
        const channel = await message.guild.channels.fetch(message.channel.id);
        const managerGuildPermissions = channel?.permissionsFor(message.author, true);
        if (hasBypassRole || hasBypassUser || managerGuildPermissions?.has("ManageGuild")) {
            return false;
        }
    }

    return true;
}