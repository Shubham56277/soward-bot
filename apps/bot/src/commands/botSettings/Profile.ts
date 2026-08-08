import { randomUUID } from "node:crypto";
import { Premium, UserProfile } from "@repo/db";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
	type User,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { mapOfficialProfileBadges } from "../../services/profile/OfficialProfileBadges";
import { profileBadgeService } from "../../services/profile/ProfileBadgeService";
import { profileAttachmentName, renderProfileCard } from "../../services/profile/ProfileCardRenderer";
import { acquireProfileAnimationLease } from "../../services/profile/ProfileAnimationLease";
import { isAnimatedDiscordAsset, isOfficialDiscordAssetUrl } from "../../services/profile/ProfileAssetLoader";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";

const PROFILE_TIMEOUT_MS = 5 * 60_000;
const NO_MENTIONS = { parse: [] as const, repliedUser: false };

function profileButtons(
	avatarUrl: string,
	bannerUrl: string | null,
	closeId: string,
	disabled = false,
): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setLabel("Avatar").setStyle(ButtonStyle.Link).setURL(avatarUrl),
	);
	if (bannerUrl) row.addComponents(new ButtonBuilder().setLabel("Banner").setStyle(ButtonStyle.Link).setURL(bannerUrl));
	return row.addComponents(
		new ButtonBuilder().setCustomId(closeId).setLabel("Close").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
	);
}
export default class Profile extends Command {
	public constructor() {
		super({
			name: "profile",
			description: {
				content: "View a generated Elfaria profile card",
				examples: ["profile", "profile @user", "profile 123456789012345678"],
				usage: "profile [user]",
			},
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks", "AttachFiles"], user: [] },
			options: [
				{ name: "user", description: "Profile to view", type: ApplicationCommandOptionType.User, required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			if (ctx.isInteraction && !ctx.interaction!.deferred && !ctx.interaction!.replied) {
				await ctx.interaction!.deferReply();
			}
			const user = await this.resolveTarget(ctx);
			if (!user) return this.notice(ctx, "User not found", "Mention a user or provide a valid Discord user ID.");

			const [premium, profile, publicFlags, guildMember] = await Promise.all([
				Premium.hasPremium(user.id).catch(() => false),
				UserProfile.get(user.id),
				user.fetchFlags().catch(() => user.flags),
				ctx.guild?.members.fetch(user.id).catch(() => null) ?? Promise.resolve(null),
			]);
			const badgeView = premium ? await profileBadgeService.activeAssigned(user.id, 5, profile) : null;
			const serverBooster = Boolean(guildMember?.premiumSince);
			const officialBadges = mapOfficialProfileBadges(publicFlags, serverBooster);

			const avatarAnimated = isAnimatedDiscordAsset(user.avatar);
			const bannerAnimated = isAnimatedDiscordAsset(user.banner);
			const avatarCandidate = user.displayAvatarURL({
				extension: avatarAnimated ? "gif" : "png",
				size: avatarAnimated ? 512 : 1024,
				forceStatic: false,
			});
			const avatarUrl = isOfficialDiscordAssetUrl(avatarCandidate)
				? avatarCandidate
				: "https://cdn.discordapp.com/embed/avatars/0.png";
			const bannerCandidate = user.bannerURL({
				extension: bannerAnimated ? "gif" : "png",
				size: 1024,
				forceStatic: false,
			});
			const bannerUrl = bannerCandidate && isOfficialDiscordAssetUrl(bannerCandidate) ? bannerCandidate : null;

			const image = await renderProfileCard({
				user,
				premium,
				profile,
				badges: badgeView,
				officialBadges,
				serverBooster,
				avatar: avatarUrl,
				banner: bannerUrl,
				avatarHash: user.avatar ?? "default",
				bannerHash: user.banner ?? "none",
				avatarAnimated,
				bannerAnimated,
				profileVersion: profile?.updatedAt ?? 0,
				badgeVersion: badgeView?.versionToken ?? "none",
				acquireAnimationLease: () => acquireProfileAnimationLease(ctx.client.redis, randomUUID()),
			});
			if (!image) {
				return this.notice(ctx, "Profile unavailable", "The profile image renderer is temporarily unavailable. Please try again later.");
			}

			const closeId = `profile_close:${ctx.id}`;
			const ownerId = ctx.author!.id;
			const renderControls = (disabled = false) => [profileButtons(avatarUrl, bannerUrl, closeId, disabled)];
			const response = await ctx.sendMessage({
				files: [new AttachmentBuilder(image.buffer, { name: profileAttachmentName(user.id, image.format) })],
				components: renderControls(),
				allowedMentions: NO_MENTIONS,
			});
			const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : response;
			const collector = message.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: PROFILE_TIMEOUT_MS,
				filter: (interaction) => interaction.customId === closeId,
			});

			collector.on("collect", async (interaction) => {
				if (interaction.user.id !== ownerId) {
					await interaction.reply({
						content: "Only the person who opened this profile can close it.",
						flags: MessageFlags.Ephemeral,
						allowedMentions: NO_MENTIONS,
					}).catch(() => undefined);
					return;
				}
				const acknowledged = await interaction.deferUpdate().then(() => true).catch(() => false);
				if (!acknowledged) return;
				collector.stop("closed");
				const deleted = await message.delete().then(() => true).catch(() => false);
				if (!deleted && message.editable) {
					await message.edit({ components: renderControls(true), allowedMentions: NO_MENTIONS }).catch(() => undefined);
				}
			});

			collector.on("end", async (_collected, reason) => {
				if (reason === "closed" || !message.editable) return;
				await message.edit({ components: renderControls(true), allowedMentions: NO_MENTIONS }).catch(() => undefined);
			});
			return message;
		} catch (error) {
			return settingsFailure(ctx, error, "profile");
		}
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return ctx.sendMessage({
			components: [settingsPanel(title, body)],
			flags: SETTINGS_FLAGS | (ctx.isInteraction ? MessageFlags.Ephemeral : 0),
			allowedMentions: NO_MENTIONS,
		});
	}

	private async resolveTarget(ctx: Context): Promise<User | null> {
		const raw = ctx.isInteraction ? "" : String(ctx.args[0] ?? "").trim();
		const selected = ctx.options.getUser("user", false, 0) ?? (!raw ? ctx.author : null);
		if (selected) return ctx.client.users.fetch(selected.id, { force: true }).catch(() => null);
		const match = raw.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
		const userId = match?.[1] ?? match?.[2];
		if (!userId) return null;
		return ctx.client.users.fetch(userId, { force: true }).catch(() => null);
	}
}
