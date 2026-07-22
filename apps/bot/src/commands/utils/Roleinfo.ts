import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import moment from "moment";

export default class Roleinfo extends Command {
	constructor() {
		super({
			name: "roleinfo",
			description: {
				content: "Get information about a role.",
				examples: ["roleinfo @Moderator", "roleinfo Admin"],
				usage: "roleinfo <role>",
			},
			category: "utils",
			aliases: ["ri"],
			cooldown: 5,
			args: true,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "EmbedLinks"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "role",
					description: "The role to get information about",
					type: 8, // Role type
					required: true,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		// Get the role from arguments or mention
		const role =  ctx.options.getRole("role", true, 0) as Role

		// If role not found
		if (!role) {
			return await ctx.sendMessage({
				content: "Role not found. Please provide a valid role name, ID, or mention.",
				flags: MessageFlags.Ephemeral,
			});
		}

		// Format permissions
		const permissions =
			role.permissions.toArray().length > 0
				? role.permissions
						.toArray()
						.map((p) => `\`${p}\``)
						.join(", ")
				: "No special permissions";

		// Format role info
		const basicInfo = [
			`**Role Name:** ${role.name}`,
			`**Role ID:** \`${role.id}\``,
			`**Role Mention:** <@&${role.id}>`,
			`**Color:** \`${role.hexColor}\` ${role.hexColor === "#000000" ? "(Default)" : ""}`,
			`**Created:** \`${moment(role.createdAt).format("M/D/YYYY")} (${moment(role.createdAt).fromNow()})\``,
			`**Position:** \`${role.position}\` (from bottom)`,
			`**Hoisted:** ${role.hoist ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
			`**Mentionable:** ${role.mentionable ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
			`**Managed:** ${role.managed ? ctx.client.config.emojis.on : ctx.client.config.emojis.off}`,
		].join("\n");

		// Format members info
		const members = role.members;
		const memberCount = members.size;
		const memberList =
			memberCount > 0
				? members
						.map((m) => m.user.username)
						.slice(0, 10)
						.join(", ") + (memberCount > 10 ? ` and ${memberCount - 10} more...` : "")
				: "No members have this role";

		// Create buttons for different info sections
		const basicButton = new ButtonBuilder().setCustomId("basic").setLabel("Basic Info").setDisabled(true).setStyle(ButtonStyle.Secondary);

		const permissionsButton = new ButtonBuilder().setCustomId("permissions").setLabel("Permissions").setStyle(ButtonStyle.Secondary);

		const membersButton = new ButtonBuilder().setCustomId("members").setLabel("Members").setStyle(ButtonStyle.Secondary);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicButton, permissionsButton, membersButton);

		// Create initial embed
		const embed = new EmbedBuilder()
			.setColor(role.color || ctx.client.config.colors.main)
			.setTitle(`${role.name} Info`)
			.setDescription(basicInfo)
			.setFooter({ text: `Role ID: ${role.id}` });

		const message = await ctx.editOrReply({
			embeds: [embed],
			components: [row],
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 30000,
            filter: (i) => {
                if (i.user.id !== ctx.author?.id) {
                    i.reply({
                        content: "Only the command author can use these buttons.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return false;
                }
                return true;
            }
		});

		collector.on("collect", async (i) => {
			if (i.customId === "basic") {
				embed.setDescription(basicInfo);
				embed.setTitle(`${role.name} Info`);

				basicButton.setDisabled(true);
				permissionsButton.setDisabled(false);
				membersButton.setDisabled(false);

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicButton, permissionsButton, membersButton);

				await i.update({ embeds: [embed], components: [row] });
			} else if (i.customId === "permissions") {
				embed.setDescription(`**Permissions:**\n${permissions}`);
				embed.setTitle(`${role.name} Permissions`);

				permissionsButton.setDisabled(true);
				basicButton.setDisabled(false);
				membersButton.setDisabled(false);

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicButton, permissionsButton, membersButton);

				await i.update({ embeds: [embed], components: [row] });
			} else if (i.customId === "members") {
				embed.setDescription(`**Members with this role (${memberCount}):**\n${memberList}`);
				embed.setTitle(`${role.name} Members`);

				membersButton.setDisabled(true);
				basicButton.setDisabled(false);
				permissionsButton.setDisabled(false);

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicButton, permissionsButton, membersButton);

				await i.update({ embeds: [embed], components: [row] });
			}
		});

		collector.on("end", async () => {
			await message.edit({ components: [] });
		});
	}
}