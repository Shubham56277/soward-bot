import { MessageFlags, Routes, UserSelectMenuInteraction } from "discord.js";
import BaseClient from "../../base/Client";
import Menu from "../../abstract/Menu";

const defaultApplications = {
	youtube: "880218394199220334", // Note : First package to include the new YouTube Together version, any other package offering it will be clearly inspired by it
	youtubedev: "880218832743055411", // Note : First package to include the new YouTube Together development version, any other package offering it will be clearly inspired by it
	poker: "755827207812677713",
	betrayal: "773336526917861400",
	fishing: "814288819477020702",
	chess: "832012774040141894",
	chessdev: "832012586023256104", // Note : First package to offer chessDev, any other package offering it will be clearly inspired by it
	lettertile: "879863686565621790", // Note : First package to offer lettertile, any other package offering it will be clearly inspired by it
	wordsnack: "879863976006127627", // Note : First package to offer wordsnack any other package offering it will be clearly inspired by it
	doodlecrew: "878067389634314250", // Note : First package to offer doodlecrew, any other package offering it will be clearly inspired by it
	awkword: "879863881349087252", // Note : First package to offer awkword, any other package offering it will be clearly inspired by it
	spellcast: "852509694341283871", // Note : First package to offer spellcast, any other package offering it will be clearly inspired by it
	checkers: "832013003968348200", // Note : First package to offer checkers, any other package offering it will be clearly inspired by it
	puttparty: "763133495793942528", // Note : First package to offer puttparty, any other package offering it will be clearly inspired by it
	sketchheads: "902271654783242291", // Note : First package to offer sketchheads any other package offering it will be clearly inspired by it
	ocho: "832025144389533716", // Note : First package to offer ocho any other package offering it will be clearly inspired by it
	puttpartyqa: "945748195256979606",
	sketchyartist: "879864070101172255", // Note : First package to offer sketchyartist, any other package offering it will be clearly inspired by it
	land: "903769130790969345",
	meme: "950505761862189096",
	askaway: "976052223358406656",
	bobble: "947957217959759964",

	rythm: "235088799074484224",
};

export default class Activity extends Menu {
	constructor(client: BaseClient) {
		super(client, {
			id: "activity-select",
		});
	}

	public async execute(interaction: UserSelectMenuInteraction): Promise<any> {
		const voice = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
		if (!voice) return;

		const value = interaction.values[0];
		if (!value) return;
		const applicationId = defaultApplications[value as keyof typeof defaultApplications];
		if (!applicationId) return;
		const route = Routes.channelInvites(voice.id);
		const invite = await interaction.client.rest.post(route, {
			body: {
				max_age: 86400,
				max_uses: 0,
				target_application_id: applicationId,
				target_type: 2,
				temporary: false,
				validate: null,
			},
		}) as any;
		
		return interaction.reply({
			content: `[Click to open ${invite.target_application!.name} in ${voice.name}](https://discord.com/invite/${invite.code})`,
			flags: MessageFlags.Ephemeral,
		});
	}
}