import { Premium, UserProfile } from "@repo/db";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	escapeMarkdown,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type User,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";

const PROFILE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_ELFARIA_ACCENT = 0x000000;
const PREMIUM_ELFARIA_ACCENT = 0xe8b84a;
const PREMIUM_BADGE = "<:premium:1532972816951935066>";
const NO_MENTIONS = { parse: [] as const };

const PUBLIC_BADGE_LABELS: Record<string, string> = {
	Staff: "Discord Staff",
	Partner: "Partnered Server Owner",
	Hypesquad: "HypeSquad Events",
	BugHunterLevel1: "Discord Bug Hunter",
	HypeSquadOnlineHouse1: "HypeSquad Bravery",
	HypeSquadOnlineHouse2: "HypeSquad Brilliance",
	HypeSquadOnlineHouse3: "HypeSquad Balance",
	PremiumEarlySupporter: "Early Supporter",
	TeamPseudoUser: "Discord Team",
	BugHunterLevel2: "Discord Bug Hunter (Gold)",
	VerifiedBot: "Verified Bot",
	VerifiedDeveloper: "Early Verified Bot Developer",
	CertifiedModerator: "Moderator Programs Alumni",
	BotHTTPInteractions: "HTTP Interactions Bot",
	ActiveDeveloper: "Active Developer",
};

const BADGE_LABELS: Record<string, string> = {
	community: "Community",
	creator: "Creator",
	gamer: "Gamer",
	helper: "Helper",
	music: "Music Lover",
	supporter: "Supporter",
};

interface ProfileCardOptions {
	user: User;
	premium: boolean;
	profile?: { bio: string | null; badges: string[] } | null;
	avatarUrl: string;
	bannerUrl: string | null;
	closeId: string;
	closeDisabled?: boolean;
}

export function sanitizeProfileText(value: unknown, maximum = 500): string {
	const text = String(value ?? "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.replace(/@/g, "@\u200b")
		.trim()
		.slice(0, maximum);
	return escapeMarkdown(text);
}

export function isOfficialDiscordImageUrl(value: string | null | undefined): value is string {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname);
	} catch {
		return false;
	}
}

export function publicBadgeLabels(flags: readonly string[]): string[] {
	return flags.map((flag) => PUBLIC_BADGE_LABELS[flag]).filter((label): label is string => Boolean(label));
}

function profileButtons(avatarUrl: string, bannerUrl: string | null, closeId: string, closeDisabled = false): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Avatar").setStyle(ButtonStyle.Link).setURL(avatarUrl));
	if (bannerUrl) row.addComponents(new ButtonBuilder().setLabel("Banner").setStyle(ButtonStyle.Link).setURL(bannerUrl));
	return row.addComponents(new ButtonBuilder().setCustomId(closeId).setLabel("Close").setStyle(ButtonStyle.Secondary).setDisabled(closeDisabled));
}

export function buildProfileCard(options: ProfileCardOptions): ContainerBuilder {
	const { user, premium, profile, avatarUrl, bannerUrl, closeId, closeDisabled = false } = options;
	const displayName = sanitizeProfileText(user.globalName || user.username, 80) || "Unknown user";
	const username = sanitizeProfileText(user.username, 80) || "Unknown";
	const publicBadges = publicBadgeLabels(user.flags?.toArray() ?? []);
	const title = premium ? `## ${PREMIUM_BADGE} ${displayName}` : `## ${displayName}`;
	const subtitle = premium ? "-# Elfaria Premium profile" : "-# Elfaria user profile";
	const heading = new SectionBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${title}\n${subtitle}`))
		.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl).setDescription(`${displayName} avatar`));
	const accountDetails = [
		`**Username**\n${username}`,
		`**User ID**\n[${user.id}](https://discord.com/users/${user.id})`,
		`**Created**\n<t:${Math.floor(user.createdTimestamp / 1_000)}:F>`,
		`**Account Type**\n${user.bot ? "Bot" : "Human"}`,
		`**Official Discord Badges**\n${publicBadges.length ? publicBadges.join(" · ") : "None"}`,
	].join("\n");
	const card = new ContainerBuilder()
		.setAccentColor(premium ? PREMIUM_ELFARIA_ACCENT : DEFAULT_ELFARIA_ACCENT)
		.addSectionComponents(heading)
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(accountDetails));

	if (premium) {
		const bio = sanitizeProfileText(profile?.bio, 190) || "No bio has been set yet.";
		const cosmeticBadges = (profile?.badges ?? []).map((badge) => BADGE_LABELS[badge]).filter((label): label is string => Boolean(label));
		card
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**${PREMIUM_BADGE} Premium Details**\n**Bio**\n${bio}\n\n**Cosmetic Badges**\n${cosmeticBadges.length ? cosmeticBadges.join(" · ") : "No cosmetic badges selected."}`,
				),
			);
		if (bannerUrl) {
			card.addMediaGalleryComponents(
				new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(bannerUrl).setDescription(`${displayName} Discord banner`)),
			);
		}
	}

	return card
		.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
		.addActionRowComponents(profileButtons(avatarUrl, bannerUrl, closeId, closeDisabled));
}

export default class Profile extends Command {
	public constructor() {
		super({
			name: "profile",
			description: { content: "View an Elfaria user profile", examples: ["profile", "profile @user"], usage: "profile [user]" },
			cooldown: 3,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			options: [{ name: "user", description: "Profile to view", type: ApplicationCommandOptionType.User, required: false }],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const user = await this.resolveTarget(ctx);
			if (!user) {
				return ctx.sendMessage({
					components: [settingsPanel("User not found", "Mention a user or provide a valid user ID.")],
					flags: SETTINGS_FLAGS,
					allowedMentions: NO_MENTIONS,
				});
			}

			const premium = await Premium.hasPremium(user.id).catch(() => false);
			const profile = premium ? await UserProfile.get(user.id).catch(() => null) : null;
			const avatarCandidate = user.displayAvatarURL({ size: 1024 });
			const avatarUrl = isOfficialDiscordImageUrl(avatarCandidate) ? avatarCandidate : "https://cdn.discordapp.com/embed/avatars/0.png";
			const bannerCandidate = premium ? user.bannerURL({ size: 1024 }) : null;
			const bannerUrl = isOfficialDiscordImageUrl(bannerCandidate) ? bannerCandidate : null;
			const closeId = `profile_close:${ctx.id}`;
			const render = (closeDisabled = false) => [buildProfileCard({ user, premium, profile, avatarUrl, bannerUrl, closeId, closeDisabled })];
			const response = await ctx.sendMessage({ components: render(), flags: SETTINGS_FLAGS, allowedMentions: NO_MENTIONS });
			const message = ctx.isInteraction ? await ctx.interaction!.fetchReply() : response;
			const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: PROFILE_TIMEOUT_MS });

			collector.on("collect", async (interaction) => {
				if (interaction.customId !== closeId) return;
				if (interaction.user.id !== ctx.author?.id) {
					await interaction
						.reply({ content: "Only the person who opened this profile can close it.", flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS })
						.catch(() => undefined);
					return;
				}
				const acknowledged = await interaction.deferUpdate().then(() => true).catch(() => false);
				if (!acknowledged) return;
				collector.stop("closed");
				const deleted = await message.delete().then(() => true).catch(() => false);
				if (!deleted && message.editable) await message.edit({ components: render(true), allowedMentions: NO_MENTIONS }).catch(() => undefined);
			});

			collector.on("end", async (_collected, reason) => {
				if (reason === "closed" || !message.editable) return;
				await message.edit({ components: render(true), allowedMentions: NO_MENTIONS }).catch(() => undefined);
			});
			return message;
		} catch (error) {
			return settingsFailure(ctx, error, "profile");
		}
	}

	private async resolveTarget(ctx: Context): Promise<User | null> {
		const raw = ctx.isInteraction ? null : String(ctx.args[0] ?? "").trim();
		const resolved = ctx.options.getUser("user", false, 0) ?? (!raw ? ctx.author : null);
		if (resolved) return ctx.client.users.fetch(resolved.id, { force: true }).catch(() => resolved);
		const match = raw?.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
		const userId = match?.[1] ?? match?.[2];
		if (!userId) return null;
		return ctx.client.users.fetch(userId, { force: true }).catch(() => null);
	}
}

export { BADGE_LABELS };
