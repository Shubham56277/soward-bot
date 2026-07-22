import { ButtonInteraction } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { startRecordingFromButton } from "../../utils/recordingControls";

export default class RecordingStart extends Button {
	constructor(client: BaseClient) {
		super(client, { id: "recording-start" });
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		return startRecordingFromButton(interaction);
	}
}
