import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ComponentType,
	ContainerBuilder,
	GuildFeature,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

const VERIFICATION_LEVELS = ["None", "Low", "Medium", "High", "Very High"] as const;

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const mins = Math.floor(seconds / 60);
	if (mins < 60) return `${mins} mins`;
	const hours = Math.floor(mins / 60);
	return `${hours}h ${mins % 60}m`;
}

export default class Guildinfo extends Command {
	public constructor() {
		super({
			name: "serverinfo",
			description: {
				content: "Get detailed information about the server",
				examples: ["serverinfo"],
				usage: "serverinfo",
			},
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel"],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const guild = ctx.guild;
		const pages = ["main", "channels", "members", "boost", "features"] as const;
		let currentPage = 0;

		const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
		const bans = await guild.bans.fetch().catch(() => null);
		const invites = await guild.invites.fetch().catch(() => null);
		const icon = guild.iconURL({ size: 512 }) ?? "https://cdn.discordapp.com/embed/avatars/0.png";

		const buildPage = (page: string): ContainerBuilder => {
			const container = new ContainerBuilder();

			// Header with server icon
			container.addSectionComponents(
				new SectionBuilder()
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${guild.name}'s Information`))
					.setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription("Server icon")),
			);
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

			switch (page) {
				case "main": {
					const vanityCode = guild.vanityURLCode;
					const vanityUses = guild.vanityURLUses ?? "N/A";
					const body = [
						"**About**",
						`**Name**: ${guild.name}`,
						`**ID**: ${guild.id}`,
						`**Owner**: ${owner?.user.username ?? "Unknown"} (\`${guild.ownerId}\`)`,
						`**Created**: <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
						`**Description**: ${guild.description || "No description set."}`,
						`**Locale**: ${guild.preferredLocale}`,
						`**Members**: ${guild.memberCount}`,
						`**Banned Members**: ${bans?.size ?? "N/A"}`,
						"",
						"**Server Settings**",
						`**Verification Level**: ${VERIFICATION_LEVELS[guild.verificationLevel] ?? "Unknown"}`,
						`**AFK Channel**: ${guild.afkChannel?.name ?? "None"}`,
						`**AFK Timeout**: ${formatDuration(guild.afkTimeout)}`,
						`**System Channel**: ${guild.systemChannel ? `#${guild.systemChannel.name}` : "None"}`,
						`**Boost Bar**: ${guild.premiumProgressBarEnabled ? "Enabled" : "Disabled"}`,
						`**Active Invites**: ${invites?.size ?? "N/A"}`,
						`**Vanity URL**: ${vanityCode ? `discord.gg/${vanityCode}` : "No vanity URL"}`,
						`**Vanity Uses**: ${vanityCode ? vanityUses : "N/A"}`,
					].join("\n");
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
					break;
				}

				case "channels": {
					const text = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
					const voice = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
					const stage = guild.channels.cache.filter(c => c.type === ChannelType.GuildStageVoice).size;
					const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;
					const forums = guild.channels.cache.filter(c => c.type === ChannelType.GuildForum).size;
					const announcements = guild.channels.cache.filter(c => c.type === ChannelType.GuildAnnouncement).size;
					const threads = guild.channels.cache.filter(c => c.isThread()).size;
					const total = guild.channels.cache.size;

					const body = [
						"**Channels**",
						`**Total**: ${total}`,
						`**Text**: ${text}`,
						`**Voice**: ${voice}`,
						`**Stage**: ${stage}`,
						`**Categories**: ${categories}`,
						`**Forums**: ${forums}`,
						`**Announcements**: ${announcements}`,
						`**Threads**: ${threads}`,
						"",
						`**Rules Channel**: ${guild.rulesChannel ? `#${guild.rulesChannel.name}` : "None"}`,
						`**System Channel**: ${guild.systemChannel ? `#${guild.systemChannel.name}` : "None"}`,
						`**AFK Channel**: ${guild.afkChannel ? `#${guild.afkChannel.name}` : "None"}`,
					].join("\n");
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
					break;
				}

				case "members": {
					const humans = guild.members.cache.filter(m => !m.user.bot).size;
					const bots = guild.members.cache.filter(m => m.user.bot).size;
					const online = guild.members.cache.filter(m => m.presence?.status === "online").size;
					const idle = guild.members.cache.filter(m => m.presence?.status === "idle").size;
					const dnd = guild.members.cache.filter(m => m.presence?.status === "dnd").size;
					const offline = guild.memberCount - online - idle - dnd;

					const body = [
						"**Members**",
						`**Total**: ${guild.memberCount}`,
						`**Humans**: ${humans}`,
						`**Bots**: ${bots}`,
						"",
						"**Presence**",
						`**Online**: ${online}`,
						`**Idle**: ${idle}`,
						`**DND**: ${dnd}`,
						`**Offline**: ${offline}`,
						"",
						`**Roles**: ${guild.roles.cache.size}`,
					].join("\n");
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
					break;
				}

				case "boost": {
					const tier = guild.premiumTier;
					const boosts = guild.premiumSubscriptionCount ?? 0;
					const tierNames = ["None", "Tier 1", "Tier 2", "Tier 3"];

					const body = [
						"**Boost Status**",
						`**Tier**: ${tierNames[tier]}`,
						`**Boosts**: ${boosts}`,
						`**Boosters**: ${guild.members.cache.filter(m => m.premiumSince).size}`,
						"",
						"**Perks**",
						`**Emoji Slots**: ${[50, 100, 150, 250][tier]}`,
						`**Sticker Slots**: ${[5, 15, 30, 60][tier]}`,
						`**Upload Limit**: ${["25MB", "25MB", "50MB", "100MB"][tier]}`,
						`**Audio Quality**: ${["96kbps", "128kbps", "256kbps", "384kbps"][tier]}`,
						`**Stream Quality**: ${tier >= 2 ? "1080p 60fps" : tier >= 1 ? "720p 60fps" : "720p 30fps"}`,
					].join("\n");
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
					break;
				}

				case "features": {
					const featureList = guild.features.length > 0
						? guild.features.map(f => `\`${f.replace(/_/g, " ").toLowerCase()}\``).join(", ")
						: "None";

					const body = [
						"**Server Features**",
						featureList,
						"",
						`**Emojis**: ${guild.emojis.cache.size} (${guild.emojis.cache.filter(e => e.animated).size} animated)`,
						`**Stickers**: ${guild.stickers.cache.size}`,
					].join("\n");
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
					break;
				}
			}

			// Footer
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`-# Requested For ${ctx.author?.username} · Today at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
			));

			return container;
		};

		const buildButtons = (disabled = false): ActionRowBuilder<ButtonBuilder> => {
			return new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("si_main").setLabel("Main Info").setStyle(currentPage === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("si_channels").setLabel("Channels").setStyle(currentPage === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("si_members").setLabel("Members").setStyle(currentPage === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("si_boost").setLabel("Boost").setStyle(currentPage === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
				new ButtonBuilder().setCustomId("si_features").setLabel("Features").setStyle(currentPage === 4 ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(disabled),
			);
		};

		const msg = await ctx.sendMessage({
			components: [buildPage(pages[currentPage]!), buildButtons()],
			flags: MessageFlags.IsComponentsV2,
			allowedMentions: { parse: [] },
		});

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 120_000,
			filter: (i) => i.user.id === ctx.author?.id,
		});

		collector.on("collect", async (i) => {
			switch (i.customId) {
				case "si_main": currentPage = 0; break;
				case "si_channels": currentPage = 1; break;
				case "si_members": currentPage = 2; break;
				case "si_boost": currentPage = 3; break;
				case "si_features": currentPage = 4; break;
			}
			await i.update({
				components: [buildPage(pages[currentPage]!), buildButtons()],
			}).catch(() => {});
		});

		collector.on("end", () => {
			msg.edit({
				components: [buildPage(pages[currentPage]!), buildButtons(true)],
			}).catch(() => {});
		});
	}
}
