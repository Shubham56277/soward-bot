import { ContainerBuilder, MessageFlags, TextChannel, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Ticket } from "@repo/db";
import { memberIsTicketStaff, performTicketClose, resolveTicketConfig } from "../../modules/ticket";

const V2_FLAGS = MessageFlags.IsComponentsV2;

function notice(title: string, description: string): { components: ContainerBuilder[]; flags: number } {
	return {
		components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))],
		flags: V2_FLAGS,
	};
}

export default class TicketClose extends Command {
	constructor() {
		super({
			name: "close",
			description: {
				content: "Close the current ticket.",
				examples: ["close"],
				usage: "close",
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

	public async run(ctx: Context): Promise<any> {
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
			return ctx.editOrReply(notice("Permission Denied", "Only administrators and support staff can close this ticket."));
		}

		if (ticket.status === "closed") {
			return ctx.editOrReply(notice("Already Closed", "This ticket is already closed."));
		}

		const channel = ctx.channel as TextChannel;
		try {
			await performTicketClose(channel, ticket, ctx.author!.id);
		} catch {
			return ctx.editOrReply(notice("Close Failed", "I could not close this ticket. Check my permissions and try again."));
		}
	}
}
