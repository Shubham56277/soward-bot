import { config } from "@repo/config";
import { Guild, User } from "@repo/db";
import { Message } from "discord.js";


export async function getPrefix(message: Message) {
    const botMention = `<@${message.client.user.id}>`
    const mention = new RegExp(`^<@!?${message.client.user?.id}>( |)$`);
    const userNoPrefix = await User.get(message.author.id).then((user) => (user?.noPrefix ? user.noPrefix : false));
    const prefix = await Guild.get(message.guildId!).then((guild) => (guild?.prefix ? guild.prefix : config.prefix));
    if (userNoPrefix) {
        if (mention.test(message.content)) {
            return botMention;
        }
        return prefix;
    } 
}
