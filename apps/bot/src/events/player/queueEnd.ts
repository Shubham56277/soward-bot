import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { TextChannel } from "discord.js";

export default class queueEnd extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "queueEnd",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.on("queueEnd", async (player, track) => {
            const guild = this.client.guilds.cache.get(player.guildId);
            if (!guild) return;
            if (!player.textChannelId) return;
         
            const messageId = player.get<string | undefined>('messageId');
            if (!messageId) return;

            const channel = guild.channels.cache.get(player.textChannelId!) as TextChannel;
            if (!channel) return;

            const message = await channel.messages.fetch(messageId).catch(() => {
                null;
            });
            if (!message) return;

            if (message.editable) {
                await message.edit({ components: [] }).catch(() => {
                    null;
                });
            }
        });
    }
}