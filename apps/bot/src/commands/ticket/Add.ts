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

export default class TicketAdd extends Command {
	constructor() {
		super({
			name: "add",
			description: {
				content: "Add a user to the current ticket channel.",
				examples: ["add @user", "add 123456789012345678"],
				usage: "add <@user|id>",
			},
			category: "ticket",
			cooldown: 5,
			args: false,
			player: { voice: false, active: false },
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "ManageChannels", "ManageRoles"],
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
			return ctx.editOrReply(notice("Permission Denied", "Only administrators and support staff can add users to this ticket."));
		}

		const target = ctx.options.getUser("user", false, 0);
		if (!target) {
			return ctx.editOrReply(notice("Add User", "Please mention a user or provide their ID. Usage: `add <@user|id>`"));
		}

		const targetMember = await ctx.guild.members.fetch(target.id).catch(() => null);
		if (!targetMember) {
			return ctx.editOrReply(notice("User Not Found", "That user is not a member of this server."));
		}

		const channel = ctx.channel as TextChannel;
		try {
			await channel.permissionOverwrites.edit(targetMember.id, {
				ViewChannel: true,
				SendMessages: true,
				ReadMessageHistory: true,
				AttachFiles: true,
			});
		} catch {
			return ctx.editOrReply(notice("Add Failed", "I could not update this channel's permissions. Check my permissions and try again."));
		}

		return ctx.editOrReply(notice("User Added", `<@${targetMember.id}> now has access to this ticket.`));
	}
}
