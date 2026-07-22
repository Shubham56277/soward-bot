import { ChatInputCommandInteraction, CommandInteraction, EmbedBuilder, Guild, GuildMember, InteractionEditReplyOptions, InteractionReplyOptions, Message, MessageCreateOptions, MessageEditOptions, MessageFlags, MessagePayload, TextBasedChannel, TextChannel, User } from "discord.js";
import BaseClient from "../base/Client";
import { compactReply } from "../utils/compactReply";


export default class Context {
	public ctx: CommandInteraction | Message;
	public interaction: ChatInputCommandInteraction | null;
	public message: Message | null;
	public id: string;
	public channelId: string;
	public client: BaseClient;
	public author: User | null;
	public channel: TextBasedChannel;
	public guild: Guild;
	public createdAt: Date;
	public createdTimestamp: number;
	public member: GuildMember | null;
	public args: any[];
	public msg: any;

	constructor(ctx: ChatInputCommandInteraction | Message, args: any[]) {
		this.ctx = ctx;
		this.interaction = ctx instanceof ChatInputCommandInteraction ? ctx : null;
		this.message = ctx instanceof Message ? ctx : null;
		this.channel = ctx.channel!;
		this.id = ctx.id;
		this.channelId = ctx.channelId;
		this.client = ctx.client as BaseClient;
		this.author = ctx instanceof Message ? ctx.author : ctx.user;
		this.guild = ctx.guild!;
		this.createdAt = ctx.createdAt;
		this.createdTimestamp = ctx.createdTimestamp;
		this.member = ctx.member as GuildMember | null;
		this.args = args;
		this.setArgs(args);
	}

	public get shardId(): number  {
		if (this.isInteraction) {
			return this.interaction?.guild?.shardId ?? 0;
		}
		return this.message?.guild?.shardId ?? 0;
	}
	public get isInteraction(): boolean {
		return this.ctx instanceof ChatInputCommandInteraction;
	}

	public setArgs(args: any[]): void {
		this.args = this.isInteraction ? args.map((arg: { value: any }) => arg.value) : args;
	}

	public async sendMessage(content: string | MessagePayload | MessageCreateOptions | InteractionReplyOptions): Promise<Message> {
		const formattedContent = this.formatResponse(content);
		if (this.isInteraction) {
			if (typeof formattedContent === "string" || isInteractionReplyOptions(formattedContent)) {
				if (this.interaction?.deferred) {
					this.msg = await this.interaction.editReply(toEditReplyOptions(formattedContent));
				} else if (this.interaction?.replied) {
					this.msg = await this.interaction.followUp(formattedContent);
				} else {
					this.msg = await this.interaction?.reply(formattedContent);
				}
				return this.msg;
			}
		} else if (typeof formattedContent === "string" || isMessagePayload(formattedContent)) {
			this.msg = await (this.message?.channel as TextChannel).send(formattedContent);
			return this.msg;
		}
		return this.msg;
	}

	public async editMessage(content: string | MessagePayload | InteractionEditReplyOptions | MessageEditOptions): Promise<Message> {
		const formattedContent = this.formatResponse(content);
		if (this.isInteraction && (this.interaction?.deferred || this.interaction?.replied)) {
			this.msg = await this.interaction.editReply(toEditReplyOptions(formattedContent as string | InteractionEditReplyOptions));
			return this.msg;
		}
		if (this.msg) {
			this.msg = await this.msg.edit(formattedContent);
			return this.msg;
		}
		return this.msg;
	}

	public async editOrReply(content: string | MessagePayload | InteractionEditReplyOptions | MessageEditOptions): Promise<Message> {
		if (this.deferred) {
			await this.editMessage(content);
		} else {
			await this.sendMessage(content as any);
		}
		return this.msg;
	}

	public async sendDeferMessage(content: string | MessagePayload | MessageCreateOptions): Promise<Message> {
		if (this.isInteraction) {
			if (this.interaction?.deferred || this.interaction?.replied) {
				this.msg = await this.interaction.fetchReply();
			} else {
				await this.interaction?.deferReply();
				this.msg = await this.interaction?.fetchReply();
			}
			return this.msg;
		}

		this.msg = await (this.message?.channel as TextChannel).send(this.formatResponse(content));
		return this.msg;
	}

	public async sendFollowUp(content: string | MessagePayload | MessageCreateOptions | InteractionReplyOptions): Promise<void> {
		const formattedContent = this.formatResponse(content);
		if (this.isInteraction) {
			if (typeof formattedContent === "string" || isInteractionReplyOptions(formattedContent)) {
				await this.interaction?.followUp(formattedContent);
			}
		} else if (typeof formattedContent === "string" || isMessagePayload(formattedContent)) {
			this.msg = await (this.message?.channel as TextChannel).send(formattedContent);
		}
	}

	public get deferred(): boolean | undefined {
		return this.isInteraction ? Boolean(this.interaction?.deferred || this.interaction?.replied) : !!this.msg;
	}

	private formatResponse<T>(content: T): T {
		const formatted = compactReply(content);
		if (!formatted || typeof formatted !== "object" || formatted instanceof MessagePayload) return formatted;

		const payload = formatted as Record<string, unknown>;
		if (!Array.isArray(payload.embeds)) return formatted;
		const brand = `Powered by ${this.client.user?.username || "Soward"}`;
		const embeds = payload.embeds.map((source) => {
			const embed = EmbedBuilder.from(source as any);
			if (embed.data.color == null) embed.setColor(this.client.config.colors.main);

			const footer = embed.data.footer;
			if (!footer) {
				embed.setFooter({ text: brand });
			} else if (!footer.text.toLowerCase().includes("powered by")) {
				const text = `${footer.text} • ${brand}`.slice(0, 2048);
				embed.setFooter(footer.icon_url ? { text, iconURL: footer.icon_url } : { text });
			}
			return embed;
		});

		return { ...payload, embeds } as T;
	}

	options = {
		getRole: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getRole(name, required);
			}
			const role = this.message?.mentions.roles.first() || this.message?.guild?.roles.cache.get(this.args[position])
			if (this.args[position]) {
				return role || this.message?.guild?.roles.cache.find(role => role.name.toLowerCase() === this.args[position].toLowerCase());
			}
			return role;
		},
		getMember: (name: string, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getMember(name);
			}

			// Get member from mentions or by ID from arguments
			const member = this.message?.mentions.members?.first() ||
				this.message?.guild?.members.cache.get(this.args[position])

			// Don't process if this is a reply to another message
			if (this.message?.reference) {
				return undefined;
			}
			// Don't return the bot itself
			if (member?.id === this.client.user?.id) {
				return undefined;
			}
			if (this.args[position]) {
				return member || this.message?.guild?.members.cache.find(member => member.user.username.toLowerCase() === this.args[position].toLowerCase());
			}
			return member;
		},

		getUser: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getUser(name, required);
			}
			
			// Get user from mentions or by ID from arguments
			const user = this.message?.mentions.users?.first() ||
				this.message?.guild?.members.cache.get(this.args[position])?.user ||
				this.client.users.cache.get(this.args[position]);
			
			if (this.message?.reference) {
				return undefined;
			}
	
			// Don't return the bot itself
			if (user?.id === this.client.user?.id) {
				return undefined;
			}
			if (this.args[position]) {
				return user || this.message?.guild?.members.cache.find(member => member.user.username.toLowerCase() === this.args[position].toLowerCase())?.user;
			}
			return user;
		},
		get: (name: string, required = true) => {
			if (this.interaction) {
				return this.interaction.options.get(name, required);
			}
			return this.args[0];
		},
		getBoolean: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getBoolean(name, required);
			}
			return this.args[position];
		},
		getString: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getString(name, required);
			}
			return this.args[position];
		},
		getNumber: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getNumber(name, required);
			}
			return this.args[position];
		},
		getInteger: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getInteger(name, required);
			}
			return this.args[position];
		},
		getChannel: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getChannel(name, required);
			}
			return this.message?.mentions.channels.first() || this.message?.guild?.channels.cache.get(this.args[position]);
		},
		getAttachment: (name: string, required = true, position = 0) => {
			if (this.interaction) {
				return this.interaction.options.getAttachment(name, required);
			}
			return this.message?.attachments.first() || this.message?.attachments.get(this.args[position]);
		},
		getSubCommand: (required: boolean = true, position?: number) => {
			if (this.interaction) {
				const subcommand = this.interaction.options.getSubcommand(required);
				if (subcommand) {
					return subcommand;
				}
			}
			return this.args[position ?? 0];
		},
		getSubcommandGroup: (required?: boolean) => {
			if (this.interaction) {
				return this.interaction.options.getSubcommandGroup(required);
			}
			return this.args[0];
		},
	};
}

function isInteractionReplyOptions(content: any): content is InteractionReplyOptions {
    return content instanceof Object;
}

function isMessagePayload(content: any): content is MessagePayload {
    return content instanceof Object;
}

function toEditReplyOptions(content: string | InteractionReplyOptions | InteractionEditReplyOptions): string | InteractionEditReplyOptions {
	if (typeof content === "string") return content;
	const options = { ...content } as InteractionEditReplyOptions & { flags?: number };
	if (typeof options.flags === "number") {
		options.flags &= ~MessageFlags.Ephemeral;
		if (options.flags === 0) delete options.flags;
	}
	return options;
}
