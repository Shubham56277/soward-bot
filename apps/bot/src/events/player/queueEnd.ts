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
        this.client.manager.on("queueEnd", (player) => {
            void this.handleQueueEnd(player).catch((error) => {
                this.client.logger.error(`[queueEnd] Failed to clear player message for guild ${player.guildId}`, error);
            });
        });
    }

    private async handleQueueEnd(player: any): Promise<void> {
        const guild = this.client.guilds.cache.get(player.guildId);
        if (!guild || !player.textChannelId) return;

        const messageId = player.get("messageId") as string | undefined;
        if (!messageId) return;

        const channel = guild.channels.cache.get(player.textChannelId) as TextChannel | undefined;
        if (!channel?.isTextBased()) return;

        const message = await channel.messages.fetch(messageId);
        if (message.editable) await message.edit({ components: [] });
    }
}