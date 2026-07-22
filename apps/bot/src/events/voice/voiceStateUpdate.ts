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
		this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
			if (!oldState?.channel && newState?.channel) {
				return VoiceManager.onRoomJoin(newState);
			}
			if (oldState?.channel && !newState?.channel) {
				return VoiceManager.onRoomLeave(oldState);
			}
			if (oldState?.channel !== newState.channel) {
				VoiceManager.onRoomJoin(newState);
				return VoiceManager.onRoomLeave(oldState);
			}
		});
	}
}
