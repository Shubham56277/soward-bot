import { GuildMember } from "discord.js";
import BaseClient from "../../base/Client";
import { createAutoRoleQueue } from "./queues/autoRoleQueue";


export class AutoRoleModule {
	private client: BaseClient;
	private member: GuildMember;

	constructor(member: GuildMember) {
		this.member = member;
		this.client = member.client as BaseClient;
	}

	public async handle() {
		try {
			const queue = createAutoRoleQueue(this.client);
			await queue.add("assign-role", {
				guildId: this.member.guild.id,
				userId: this.member.id,
			});
		} catch (error) {
			console.error("Failed to queue auto role job:", error);
		}
	}
}
