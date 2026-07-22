import { ButtonInteraction } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { stopRecordingFromButton } from "../../utils/recordingControls";

export default class RecordingStop extends Button {
	constructor(client: BaseClient) {
		super(client, { id: "recording-stop" });
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		return stopRecordingFromButton(interaction);
	}
}
