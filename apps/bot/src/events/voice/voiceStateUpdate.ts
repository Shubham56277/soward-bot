import { Events } from "discord.js";
import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import VoiceManager from "../../lib/VoiceManager";

export default class voiceStateUpdate extends Event {
	constructor(client: BaseClient) {
		super(client, {
			event: Events.VoiceStateUpdate,
		});
	}

	public async execute(): Promise<void> {
		this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
			void this.handleVoiceStateUpdate(oldState, newState).catch((error) => {
				this.client.logger.error(`[voice-state] Failed to process update in guild ${newState.guild.id}`, error);
			});
		});
	}

	private async handleVoiceStateUpdate(oldState: Parameters<typeof VoiceManager.onRoomLeave>[0], newState: Parameters<typeof VoiceManager.onRoomJoin>[0]): Promise<void> {
		if (!oldState.channel && newState.channel) {
			await VoiceManager.onRoomJoin(newState);
			return;
		}
		if (oldState.channel && !newState.channel) {
			await VoiceManager.onRoomLeave(oldState);
			return;
		}
		if (oldState.channelId !== newState.channelId) {
			await VoiceManager.onRoomJoin(newState);
			await VoiceManager.onRoomLeave(oldState);
		}
	}
}
