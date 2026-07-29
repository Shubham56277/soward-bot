import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events, GatewayDispatchEvents } from "discord.js";
import { isRecordingGuild } from "../../service/voiceRecordingService";

export default class Raw extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: Events.Raw,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.Raw, (d) => {
            // The record feature joins voice through @discordjs/voice, which owns its
            // own voice session. Lavalink also consumes VOICE_STATE_UPDATE and
            // VOICE_SERVER_UPDATE for the bot, and if it receives them while a
            // recording is running it takes over that session and the recorder loses
            // audio. So while a guild is recording, the bot's own voice packets are
            // withheld from Lavalink. Every other packet, including other members'
            // voice states, is forwarded unchanged.
            try {
                if (this.shouldWithholdFromLavalink(d)) return;
            } catch {
                // A malformed packet must never break the raw handler; fall through
                // and forward it exactly as before.
            }
            this.client.manager.sendRawData(d);
        });
    }

    private shouldWithholdFromLavalink(packet: any): boolean {
        const type = packet?.t;
        if (type !== GatewayDispatchEvents.VoiceStateUpdate && type !== GatewayDispatchEvents.VoiceServerUpdate) return false;

        const guildId = packet?.d?.guild_id;
        if (typeof guildId !== "string" || !isRecordingGuild(guildId)) return false;

        // Only the bot's own voice state belongs to the recorder; other members'
        // states are still needed by Lavalink for its voice-channel bookkeeping.
        if (type === GatewayDispatchEvents.VoiceStateUpdate) {
            return packet?.d?.user_id === this.client.user?.id;
        }
        return true;
    }
}
