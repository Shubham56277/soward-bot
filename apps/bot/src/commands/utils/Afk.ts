import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { AFK } from "@repo/db";

export default class AfkCommand extends Command {
	constructor() {
		super({
			name: "afk",
			description: {
				content: "Set your AFK status globally or for this server",
				examples: ["afk", "afk brb in 10 mins", "afk global eating lunch"],
				usage: "afk [reason]",
			},
			category: "utils",
			aliases: ["pong"],
			cooldown: 8,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel"],
				user: [],
			},
			slashCommand: true,
			options: [
				{ name: "reason", type: 3, description: "Reason for AFK", required: false },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		let reason = ctx.args.join(" ");
		if (ctx.isInteraction) reason = ctx.options.getString("reason", false) as string ?? "";

		// Sanitize reason — remove links and invites
		if (reason) {
			reason = reason.replace(/https?:\/\/[^\s]+/g, "").replace(/discord\.gg\/[^\s]+/g, "").trim();
		}

		const body = [
			"**AFK**",
			"Set your away status. Members who mention you will be notified.",
			"",
			"Choose where to apply:",
		].join("\n");

		const panel = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

		const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("afk-global").setLabel("Global").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId("afk-server").setLabel("This Server").setStyle(ButtonStyle.Primary),
		);

		const message = await ctx.editOrReply({
			components: [panel, buttons],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			time: 60_000,
			componentType: ComponentType.Button,
			filter: async (i) => {
				if (i.user.id === ctx.author?.id) return true;
				await i.reply({
					components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("You cannot use this button."))],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				});
				return false;
			},
		});

		collector.on("collect", async (i) => {
			collector.stop();

			let scope: string;
			if (i.customId === "afk-global") {
				await AFK.create(ctx.author?.id ?? "", { reason, mentionBy: [], global: true });
				scope = "Globally";
			} else {
				await AFK.create(ctx.author?.id ?? "", { reason, mentionBy: [], guildId: ctx.guild?.id });
				scope = ctx.guild?.name ?? "This Server";
			}

			const result = [
				"**AFK Set**",
				`Scope: **${scope}**`,
				reason ? `Reason: ${reason}` : "No reason provided.",
			].join("\n");

			await i.update({
				components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(result))],
			});
		});

		collector.on("end", (collected, reason) => {
			if (reason === "time" && collected.size === 0) {
				message.edit({
					components: [
						new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("AFK setup timed out.")),
					],
				}).catch(() => {});
			}
		});
	}
}
