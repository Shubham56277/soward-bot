import { MediaChannel } from "@repo/db";
import { ChannelType, Message } from "discord.js";

export async function handleMediaMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const mediaChannel = await MediaChannel.getByGuildIdAndChannelId(
        message.guild?.id,
        message.channel.id,
    );
    if (!mediaChannel) return;
    const isUserHavePermission = message.member?.permissions.has(
        [
            "ManageGuild",
            "Administrator"
        ]
    )
    // ignore messages from users with manage guild permission
    if (isUserHavePermission) return;
    const hasMedia = message.attachments.size > 0 ||
        message.embeds.some((e) =>
            e.data.type === "image" || e.data.type === "video"
        );

    if (!hasMedia) {
        try {
            await message.delete();
        } catch (error) {
            console.error("Failed to delete message:", error);
        }
    }
}
