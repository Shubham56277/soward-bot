import {
    Collection,
    GuildMember,
    Message,
    TextBasedChannel,
    PermissionFlagsBits,
} from 'discord.js';

export type PurgeType = 'ALL' | 'ATTACHMENT' | 'BOT' | 'LINK' | 'TOKEN' | 'USER';
export type PurgeResult = number | 'MEMBER_PERM' | 'BOT_PERM' | 'NO_MESSAGES' | 'ERROR';

const LINK_REGEX = /https?:\/\/[^\s]+/i;
const MAX_MESSAGES_SCANNED = 1_000;

/**
 * Advanced message purging utility with multiple filtering options
 * @param issuer The member initiating the purge
 * @param channel The channel to purge messages from
 * @param type The type of purge to perform
 * @param amount The maximum number of messages to purge
 * @param argument Optional argument for certain purge types
 * @returns Promise resolving to the number of messages deleted or an error code
 */
export async function purgeMessages(
    issuer: GuildMember,
    channel: TextBasedChannel,
    type: PurgeType,
    amount: number,
    argument?: string
): Promise<PurgeResult> {
    // Validate permissions
    if (!channel.isTextBased() || channel.isDMBased()) {
        return 'ERROR';
    }

    const requiredPermissions = [
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
    ];

    if (!issuer.permissionsIn(channel).has(requiredPermissions)) {
        return 'MEMBER_PERM';
    }

    if (!channel.guild.members.me?.permissionsIn(channel).has(requiredPermissions)) {
        return 'BOT_PERM';
    }

    // Discord only accepts 1-100 messages per bulk-delete request.
    amount = Number.isFinite(amount) ? Math.min(Math.max(Math.trunc(amount), 1), 100) : 1;

    try {
        const messagesToDelete = new Collection<string, Message>();
        let lastMessageId: string | undefined;
        let scanned = 0;

        // Bound history scans so sparse filters cannot walk an entire channel.
        while (messagesToDelete.size < amount && scanned < MAX_MESSAGES_SCANNED) {
            const fetchOptions = { limit: Math.min(100, MAX_MESSAGES_SCANNED - scanned), before: lastMessageId };
            const messages = await channel.messages.fetch(fetchOptions);

            if (messages.size === 0) break;
            scanned += messages.size;

            for (const message of messages.values()) {
                if (messagesToDelete.size >= amount) break;
                if (!message.deletable) continue;

                let shouldDelete = false;

                switch (type) {
                    case 'ALL':
                        shouldDelete = true;
                        break;
                    case 'ATTACHMENT':
                        shouldDelete = message.attachments.size > 0;
                        break;
                    case 'BOT':
                        shouldDelete = message.author.bot;
                        break;
                    case 'LINK':
                        shouldDelete = LINK_REGEX.test(message.content);
                        break;
                    case 'TOKEN':
                        shouldDelete = argument ? message.content.includes(argument) : false;
                        break;
                    case 'USER':
                        shouldDelete = argument ? message.author.id === argument : false;
                        break;
                }

                if (shouldDelete) {
                    messagesToDelete.set(message.id, message);
                }
            }

            lastMessageId = messages.last()?.id;
        }

        if (messagesToDelete.size === 0) {
            return 'NO_MESSAGES';
        }

        // Perform the bulk delete
        const deletedMessages = await channel.bulkDelete(messagesToDelete, true);
        return deletedMessages.size;
    } catch (error) {
        console.error('Error purging messages:', error);
        return 'ERROR';
    }
}