import { ChannelType, ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

const TIER_NAMES = ["None", "Tier 1", "Tier 2", "Tier 3"] as const;
const EMOJI_LIMITS = [50, 100, 150, 250] as const;
const STICKER_LIMITS = [5, 15, 30, 60] as const;
const UPLOAD_LIMITS = ["25MB", "25MB", "50MB", "100MB"] as const;
const NEXT_BOOST_LEVEL = [2, 7, 14, null] as const;

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
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const guild = ctx.guild;
		const owner = await guild.members.fetch(guild.ownerId).catch(() => null);
		const tier = Math.max(0, Math.min(3, Number(guild.premiumTier))) as 0 | 1 | 2 | 3;
		const boosts = guild.premiumSubscriptionCount ?? 0;
		const nextLevel = NEXT_BOOST_LEVEL[tier];
		const staticEmojis = guild.emojis.cache.filter((emoji) => !emoji.animated).size;
		const animatedEmojis = guild.emojis.cache.filter((emoji) => emoji.animated).size;
		const voiceChannels = guild.channels.cache.filter(
			(channel) => channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice,
		);
		const activeVoiceChannels = voiceChannels.filter((channel) => channel.members.size > 0);
		const activeVoiceUsers = guild.voiceStates.cache.filter((state) => Boolean(state.channelId)).size;
		const hotSpot = [...activeVoiceChannels.values()].sort((a, b) => b.members.size - a.members.size)[0];
		const topRoles = [...guild.roles.cache.values()]
			.filter((role) => role.id !== guild.id)
			.sort((a, b) => b.position - a.position)
			.slice(0, 10);

		const verification = ["None", "Low", "Medium", "High", "Very High"][guild.verificationLevel] ?? "Unknown";
		const explicitFilter = ["Disabled", "Members without roles", "All members"][guild.explicitContentFilter] ?? "Unknown";
		const notifications = guild.defaultMessageNotifications === 1 ? "Only mentions" : "All messages";
		const inactive = guild.afkChannel ? `${guild.afkChannel} after ${formatDuration(guild.afkTimeout)}` : "None";
		const welcomeMessages = guild.systemChannel
			? !guild.systemChannelFlags.has("SuppressJoinNotifications")
			: false;
		const boostMessages = guild.systemChannel
			? !guild.systemChannelFlags.has("SuppressPremiumSubscriptions")
			: false;
		const progress = nextLevel === null ? `${boosts} / Maximum tier` : `${boosts} / ${nextLevel}`;
		const soundboardCount = guild.soundboardSounds.cache.size;

		const description = [
			"**Server Information**",
			`> **Owner:** ${owner ?? `<@${guild.ownerId}>`}`,
			`> **Created:** <t:${Math.floor(guild.createdTimestamp / 1_000)}:R>`,
			`> **Guild ID:** \`${guild.id}\``,
			"",
			"**Statistics**",
			`> **Members:** \`${guild.memberCount}\``,
			`> **Channels:** \`${guild.channels.cache.size}\``,
			`> **Roles:** \`${guild.roles.cache.size - 1}\``,
			"",
			"**Voice Stats**",
			`> **Active Users:** \`${activeVoiceUsers}\``,
			`> **Active Channels:** \`${activeVoiceChannels.size}\``,
			`> **Hot Spot:** ${hotSpot ? `${hotSpot} \`${hotSpot.members.size}\`` : "`None`"}`,
			"",
			"**Boost Status**",
			`> **Tier:** \`${TIER_NAMES[tier]}\``,
			`> **Progress:** \`${progress}\``,
			`> **Uploads:** \`${UPLOAD_LIMITS[tier]}\``,
			`> **Emojis:** \`${staticEmojis}\` / \`${EMOJI_LIMITS[tier]}\` static · \`${animatedEmojis}\` / \`${EMOJI_LIMITS[tier]}\` animated`,
			`> **Stickers:** \`${guild.stickers.cache.size}\` / \`${STICKER_LIMITS[tier]}\``,
			`> **Soundboard:** \`${soundboardCount}\``,
			`> **Banner:** \`${guild.banner ? "Enabled" : "Disabled"}\``,
			"",
			"**Security & Settings**",
			`> **Verification:** \`${verification}\``,
			`> **Explicit Content:** \`${explicitFilter}\``,
			`> **2FA Requirement:** \`${guild.mfaLevel ? "Enabled" : "Disabled"}\``,
			`> **Notifications:** \`${notifications}\``,
			`> **Inactive Timeout:** ${inactive}`,
			`> **System Channel:** ${guild.systemChannel ?? "`None`"}`,
			`> **Welcome Messages:** \`${welcomeMessages ? "Enabled" : "Disabled"}\` · **Boost Messages:** \`${boostMessages ? "Enabled" : "Disabled"}\``,
			"",
			`**Top Roles (${topRoles.length})**`,
			topRoles.length ? topRoles.map((role) => role.toString()).join(" ") : "-# **No displayable roles.**",
		].join("\n");

		const panel = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder()
				.setContent(`## ${guild.name}'s Info\n${description}\n\n-# ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date())} · Powered by ${ctx.client.user?.username || "Soward"}`));

		return ctx.editOrReply({ components: [panel], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], repliedUser: false } });
	}
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	if (seconds < 3_600) return `${Math.round(seconds / 60)} minutes`;
	return `${Math.round(seconds / 3_600)} hours`;
}
