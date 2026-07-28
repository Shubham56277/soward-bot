import { ContainerBuilder, MessageFlags, TextChannel, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Ticket } from "@repo/db";
import { memberIsTicketStaff, resolveTicketConfig } from "../../modules/ticket";

const V2_FLAGS = MessageFlags.IsComponentsV2;

function notice(title: string, description: string): { components: ContainerBuilder[]; flags: number } {
	return {
		components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))],
		flags: V2_FLAGS,
	};
}

/** Convert arbitrary text into a valid Discord channel name. */
function sanitizeChannelName(input: string): string {
	const cleaned = input
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9\-_]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 90);
	return cleaned;
}

export default class TicketRename extends Command {
	constructor() {
		super({
			name: "rename",
			description: {
				content: "Rename the current ticket channel.",
				examples: ["rename billing issue", "rename urgent-support"],
				usage: "rename <new name>",
			},
			category: "ticket",
			cooldown: 5,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "ManageChannels"],
				user: [],
			},
			slashCommand: false,
		});
	}

	public async run(ctx: Context, args: string[]): Promise<any> {
		const ticket = await Ticket.getTicketByChannelId(ctx.guild.id, ctx.channelId);
		// Silently ignore in non-ticket channels.
		if (!ticket) {
			return;
		}

		const config = await resolveTicketConfig(ctx.guild.id, ticket);
		if (!config) {
			return;
		}

		const member = ctx.member ?? (await ctx.guild.members.fetch(ctx.author!.id).catch(() => null));
		if (!member || !memberIsTicketStaff(member, config)) {
			return ctx.editOrReply(notice("Permission Denied", "Only administrators and support staff can rename this ticket."));
		}

		const rawName = args.join(" ").trim();
		if (!rawName) {
			return ctx.editOrReply(notice("Rename Ticket", "Please provide a new name. Usage: `rename <new name>`"));
		}

		const newName = sanitizeChannelName(rawName);
		if (!newName) {
			return ctx.editOrReply(notice("Invalid Name", "That name is not valid for a channel. Use letters, numbers, or dashes."));
		}

		const channel = ctx.channel as TextChannel;
		try {
			await channel.setName(newName, `Ticket renamed by ${ctx.author?.tag ?? ctx.author?.id}`);
		} catch {
			return ctx.editOrReply(notice("Rename Failed", "I could not rename this channel. Check my permissions and try again."));
		}

		return ctx.editOrReply(notice("Ticket Renamed", `This ticket channel was renamed to **#${newName}**.`));
	}
}
