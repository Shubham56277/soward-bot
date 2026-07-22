import { ButtonInteraction } from "discord.js";
import Button from "../../abstract/Button";
import BaseClient from "../../base/Client";
import { giveawaysManager } from "../../lib/giveaways/giveawaysManager";

export default class GiveawayJoin extends Button {
	constructor(client: BaseClient) {
		super(client, {
			id: "giveaway_join",
		});
	}

	public async execute(interaction: ButtonInteraction): Promise<any> {
		await giveawaysManager.join(interaction, interaction.guildId!, interaction.message.id, interaction.user.id);
	}
}
