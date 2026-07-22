import { ActionRowBuilder, ApplicationCommandOptionType, AttachmentBuilder, ButtonBuilder, ButtonStyle, GuildMember } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Banner extends Command {
	constructor() {
		super({
			name: "banner",
			description: {
				content: "Get the banner of a user.",
				examples: ["banner", "banner @user"],
				usage: "banner",
			},
			category: "utils",
			aliases: [],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "user",
					description: "The user to get the avatar of",
					type: ApplicationCommandOptionType.User,
					required: false,
				},
			],
		});
	}
	public async run(ctx: Context): Promise<any> {
		const member = (ctx.options?.getMember("user") as GuildMember) || (ctx.member as GuildMember);
		const user = await member.user.fetch(true);
		const globalBannerUrl = user.bannerURL({ size: 4096 });
		
		if (!globalBannerUrl) {
			return ctx.editOrReply({ content: "This user has no banner." });
		}
		const bannerUrl = member.bannerURL({ size: 4096 });
      
		const button = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(globalBannerUrl));
		if (globalBannerUrl !== bannerUrl && bannerUrl) {
			button.addComponents(new ButtonBuilder().setLabel("Guild Banner").setStyle(ButtonStyle.Secondary).setCustomId("guild-banner"));
		}
		const media = new AttachmentBuilder(globalBannerUrl).setFile(globalBannerUrl, "banner.gif");

		const msg = await ctx.editOrReply({
			content: `-# Here is ${user}'s banner`,
			components: [button],
			files: [media],
		});

		const filter = (i: any) => i.user.id === ctx.author?.id;
		const collector = msg.createMessageComponentCollector({ filter, time: 15000 });

		collector.on("collect", async (i) => {
			if (i.customId === "guild-banner") {
				const guildBannerUrl = member.bannerURL({ size: 4096 });
				if (!guildBannerUrl) {
					return i.update({ content: "This user has no banner." });
				}
				const media = new AttachmentBuilder(guildBannerUrl).setFile(guildBannerUrl, "banner.gif");
				await i.update({
					content: `-# Here is ${user}'s banner`,
					components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(guildBannerUrl))],
					files: [media],
				});
			}
		});
	}
}
