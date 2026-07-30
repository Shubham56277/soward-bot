import Command from "../../abstract/Command";
import Context from "../../lib/Context";

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
		const { Guild: GuildDb } = await import("@repo/db");
		const guildData = await GuildDb.get(ctx.guild.id);
		const prefix = guildData?.prefix ?? ctx.client.config.prefix;

		const body = [
			"## 🛡 Security",
			"*Manage AntiNuke protection, extra owners, and whitelist settings.*",
			"",
			"**AntiNuke**",
			`\`${prefix}antinuke\` — Open the security dashboard`,
			`\`${prefix}antinuke enable\` — Enable protection`,
			`\`${prefix}antinuke disable\` — Disable protection`,
			`\`${prefix}antinuke config\` — Configure protection modules`,
			`\`${prefix}antinuke punishment <ban|kick|rolestrip>\` — Set enforcement action`,
			"",
			"**Extra Owners**",
			`\`${prefix}extraowner\` — Open the extra owners dashboard`,
			`\`${prefix}extraowner add @user\` — Add an extra owner`,
			`\`${prefix}extraowner remove @user\` — Remove an extra owner`,
			`\`${prefix}extraowner config @user\` — Configure an extra owner`,
			`\`${prefix}extraowner reset\` — Remove all extra owners`,
			"",
			"**Whitelist**",
			`\`${prefix}antinuke whitelist add @user\` — Add a whitelist exemption`,
			`\`${prefix}antinuke whitelist remove @user\` — Remove a whitelist exemption`,
			`\`${prefix}antinuke whitelist list\` — View all whitelisted users`,
			`\`${prefix}antinuke whitelist reset\` — Clear the whitelist`,
		].join("\n");

		return ctx.sendMessage({ content: body });
	}
}
