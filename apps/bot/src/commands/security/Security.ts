import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";

function panel(title: string, body: string): ContainerBuilder {
	return new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛡 ${title}`))
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

export default class SecurityCommand extends Command {
	constructor() {
		super({
			name: "security",
			description: {
				content: "Security overview and quick links",
				usage: "security",
				examples: ["security"],
			},
			category: "security",
			cooldown: 5,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel"], user: ["Administrator"] },
			slashCommand: true,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const body = [
			"**Server Security**",
			"*Manage AntiNuke protection, extra owners, and whitelist settings.*",
			"",
			"**AntiNuke**",
			"`antinuke` — Open the security dashboard",
			"`antinuke enable` — Enable protection",
			"`antinuke disable` — Disable protection",
			"`antinuke config` — Configure protection modules",
			"`antinuke punishment <ban|kick|rolestrip>` — Set enforcement action",
			"",
			"**Extra Owners**",
			"`extraowner` — Open the extra owners dashboard",
			"`extraowner add @user` — Add an extra owner",
			"`extraowner remove @user` — Remove an extra owner",
			"`extraowner config @user` — Configure an extra owner",
			"`extraowner reset` — Remove all extra owners",
			"",
			"**Whitelist**",
			"`antinuke whitelist add @user` — Add a whitelist exemption",
			"`antinuke whitelist remove @user` — Remove a whitelist exemption",
			"`antinuke whitelist list` — View all whitelisted users",
			"`antinuke whitelist reset` — Clear the whitelist",
		].join("\n");

		return ctx.editOrReply({
			components: [panel("Security", body)],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}
