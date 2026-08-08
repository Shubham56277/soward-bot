import {
	ContainerBuilder,
	GuildMember,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

const KEY_PERMISSIONS = [
	{ flag: PermissionFlagsBits.Administrator, name: "Administrator" },
	{ flag: PermissionFlagsBits.ManageGuild, name: "Manage Guild" },
	{ flag: PermissionFlagsBits.ManageChannels, name: "Manage Channels" },
	{ flag: PermissionFlagsBits.ManageRoles, name: "Manage Roles" },
	{ flag: PermissionFlagsBits.ManageMessages, name: "Manage Messages" },
	{ flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
	{ flag: PermissionFlagsBits.KickMembers, name: "Kick Members" },
	{ flag: PermissionFlagsBits.ManageWebhooks, name: "Manage Webhooks" },
	{ flag: PermissionFlagsBits.MentionEveryone, name: "Mention Everyone" },
	{ flag: PermissionFlagsBits.ManageNicknames, name: "Manage Nicknames" },
];

export default class UserInfoCommand extends Command {
	constructor() {
		super({
			name: "info",
			description: {
				content: "Get detailed information about a user",
				examples: ["info", "info @user"],
				usage: "info [user]",
			},
			category: "utils",
			aliases: ["userinfo", "whois", "ui"],
			cooldown: 5,
			args: false,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel"],
				user: [],
			},
			slashCommand: true,
			options: [
				{ name: "user", description: "User to look up", type: 6, required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const member = (ctx.options.getMember("user", 0) as GuildMember | undefined) ?? ctx.member;
		if (!member) return ctx.sendMessage("User not found.");

		const user = member.user;
		// Force fetch to get banner
		const fetchedUser = await ctx.client.users.fetch(user.id, { force: true }).catch(() => user);

		const avatar = member.displayAvatarURL({ size: 512, forceStatic: false });
		const banner = fetchedUser.bannerURL({ size: 1024, forceStatic: false });

		const topRole = member.roles.highest.id !== ctx.guild.id ? member.roles.highest : null;
		const totalRoles = member.roles.cache.size - 1; // Exclude @everyone

		const keyPerms = KEY_PERMISSIONS
			.filter(p => member.permissions.has(p.flag))
			.map(p => p.name);

		// Acknowledgement
		let acknowledgement = "Member";
		if (user.id === ctx.guild.ownerId) acknowledgement = "Server Owner";
		else if (member.permissions.has(PermissionFlagsBits.Administrator)) acknowledgement = "Server Administrator";
		else if (member.permissions.has(PermissionFlagsBits.ManageGuild)) acknowledgement = "Server Manager";
		else if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) acknowledgement = "Server Moderator";

		// Build container
		const container = new ContainerBuilder();

		// Header with avatar thumbnail
		container.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${user.username}'s info`))
				.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Avatar")),
		);

		// General section
		const generalLines = [
			"**General**",
			`**Name**: ${user.username}`,
			`**ID**: ${user.id}`,
			`**Nickname**: ${member.nickname ?? "None"}`,
			`**Is Bot**: ${user.bot ? "Yes" : "No"}`,
			`**Account Created**: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
			`**Server Joined**: <t:${Math.floor((member.joinedTimestamp ?? Date.now()) / 1000)}:R>`,
		];
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(generalLines.join("\n")));

		// Roles section
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		const rolesLines = [
			"**Roles**",
			`**Top Role**: ${topRole ? `<@&${topRole.id}>` : "None"}`,
			`**Total Roles**: ${totalRoles}`,
		];
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rolesLines.join("\n")));

		// Extras section
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		const extrasLines = [
			"**Extras**",
			`**Boosting**: ${member.premiumSince ? `Since <t:${Math.floor(member.premiumSinceTimestamp! / 1000)}:R>` : "Not boosting"}`,
			`**Voice**: ${member.voice.channel ? `#${member.voice.channel.name}` : "Not in a voice channel"}`,
		];
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(extrasLines.join("\n")));

		// Key Perms section
		if (keyPerms.length > 0) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`**Key Perms**\n${keyPerms.join(", ")}`
			));
		}

		// Acknowledgement
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
			`**Acknowledgement**\n${acknowledgement}`
		));

		// Banner (if user has one)
		if (banner) {
			container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
			container.addMediaGalleryComponents(
				new MediaGalleryBuilder().addItems(
					new MediaGalleryItemBuilder().setURL(banner).setDescription("Banner"),
				),
			);
		}

		// Footer
		container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
			`-# Requested by ${ctx.author?.username} · Today at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
		));

		return ctx.sendMessage({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
			allowedMentions: { parse: [] },
		});
	}
}
