import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, GuildMember, Message, PermissionResolvable } from "discord.js";
import { CommandOptions } from "../abstract/Command";
import { constants } from "../config/constants";

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const dangerPermissions: PermissionResolvable[] = [
	"Administrator",
	"ManageGuild",
	"ManageRoles",
	"ManageChannels",
	"BanMembers",
	"KickMembers",
	"ManageMessages",
	"MentionEveryone",
	"ManageWebhooks",
];
export const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Generate a unique ID
 */
export function generateId(): string {
	return require("node:crypto").randomBytes(16).toString("hex");
}

/**
 * Format duration from milliseconds
 */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

/**
 * Parse duration string to milliseconds
 */
export function parseDuration(input: string): number | null {
	const match = input.match(/^(\d+)(s|m|h|d)$/i);
	if (!match) return null;

	const value = parseInt(match[1], 10);
	const unit = match[2].toLowerCase();

	switch (unit) {
		case 's': return value * 1000;
		case 'm': return value * 60 * 1000;
		case 'h': return value * 60 * 60 * 1000;
		case 'd': return value * 24 * 60 * 60 * 1000;
		default: return null;
	}
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, length: number): string {
	if (str.length <= length) return str;
	return `${str.slice(0, length - 3)}...`;
}

/**
 * Sleep for specified milliseconds
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if string is a valid URL
 */
export function isValidUrl(str: string): boolean {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

/**
 * Escape markdown characters
 */
export function escapeMarkdown(str: string): string {
	return str.replace(/[*_~`|\\]/g, '\\$&');
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
	return num.toLocaleString();
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

/**
 * Shuffle array
 */
export function shuffle<T>(array: T[]): T[] {
	const result = [...array];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export async function sendCommandHelp(message: Message, command: CommandOptions) {
	const subcommands = command.options?.filter((opt) => opt.type === 1) || [];
	const examples = command.description?.examples || [];
	const hasExtraExamples = examples.length > 3;

	const baseEmbed = new EmbedBuilder()
		.setTitle(`Help: ${command.name}`)
		.setColor(constants.colors.main)
		.setDescription(`### ${command.description?.content || "No description provided."}`)
		.addFields([
			{ name: "Category", value: `\`${command.category || "Uncategorized"}\``, inline: true },
			...(command.aliases?.length ? [{ name: "Aliases", value: `\`${command.aliases.join(", ")}\``, inline: true }] : []),
			...(command.cooldown ? [{ name: "Cooldown", value: `\`${command.cooldown}s\``, inline: true }] : []),
		]);

	if (examples.length && !hasExtraExamples) {
		baseEmbed.addFields({
			name: "Examples",
			value: examples.map((ex) => `\`${ex}\``).join("\n"),
		});
	}

	if (command.permissions) {
		const perms: string[] = [];
		if (command.permissions.dev) perms.push("Developer only");
		if (command.permissions.client?.length) perms.push(`Client: \`${command.permissions.client.join("`, `")}\``);
		if (command.permissions.user?.length) perms.push(`User: \`${command.permissions.user.join("`, `")}\``);
		baseEmbed.addFields({ name: "Permissions Required", value: perms.join("\n") });
	}

	const baseRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId("view_subcommands").setLabel("View Subcommands").setStyle(ButtonStyle.Primary).setDisabled(!subcommands.length),
		new ButtonBuilder().setCustomId("view_examples").setLabel("View Examples").setStyle(ButtonStyle.Secondary).setDisabled(!hasExtraExamples),
	);

	const subEmbed = new EmbedBuilder()
		.setTitle(`Subcommands: ${command.name}`)
		.setColor(constants.colors.main)
		.setDescription(
			subcommands.length
				? subcommands
						.map(
							(sub) =>
								`• \`${sub.name}\` — ${sub.description || "No description"}${
									sub.options?.length ? `\n  ↳ ${sub.options.map((opt) => `\`${opt.name}\`${opt.required ? " *(required)*" : ""}`).join(", ")}` : ""
								}`,
						)
						.join("\n")
				: "No subcommands found.",
		);

	const examplesEmbed = new EmbedBuilder()
		.setTitle(`Examples: ${command.name}`)
		.setColor(constants.colors.main)
		.setDescription(examples.length ? examples.map((ex) => `• \`${ex}\``).join("\n") : "No examples provided.");

	const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("back_to_main").setLabel("Back").setStyle(ButtonStyle.Secondary));

	const msg = await message.reply({
		embeds: [baseEmbed],
		components: [baseRow],
	});

	const collector = msg.createMessageComponentCollector({
		filter: (i) => i.user.id === message.author.id,
		time: 60_000,
	});

	collector.on("collect", async (btn) => {
		if (btn.customId === "view_subcommands") {
			await btn.update({
				embeds: [subEmbed],
				components: [navRow],
			});
		} else if (btn.customId === "view_examples") {
			await btn.update({
				embeds: [examplesEmbed],
				components: [navRow],
			});
		} else if (btn.customId === "back_to_main") {
			await btn.update({
				embeds: [baseEmbed],
				components: [baseRow],
			});
		}
	});

	collector.on("end", async () => {
		if (!msg.editable) return;
		const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...baseRow.components.map((c) => ButtonBuilder.from(c).setDisabled(true)));
		await msg.edit({ components: [disabledRow] });
	});
}

// function to check is url or not
export function IsUrl(text: string) {
	try {
		const url = new URL(text);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch (_e) {
		return false;
	}
}

export function replacePlaceholders(text: string, member: GuildMember, guild: Guild) {
	return text
		.replace(/{server}/g, guild.name)
		.replace(/{user}/g, member.user.username)
		.replace(/{servericon}/g, guild.iconURL() ?? "")
		.replace(/{membercount}/g, guild.memberCount.toString())
		.replace(/{tag}/g, member.user.tag)
		.replace(/{username}/g, member.user.username)
		.replace(/{displayname}/g, member.displayName)
		.replace(/{mention}/g, member.toString())
		.replace(/{avatar}/g, member.user.displayAvatarURL())
		.replace(/{id}/g, member.id)
		.replace(/{time}/g, new Date().toLocaleTimeString())
		.replace(/{timezone}/g, new Date().toLocaleString())
		.replace(/{utc}/g, new Date().toUTCString())
		.replace(/{date}/g, new Date().toLocaleDateString());
}
