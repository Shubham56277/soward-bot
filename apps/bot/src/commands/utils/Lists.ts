import { ChannelType, EmbedBuilder, GuildMember, VoiceBasedChannel, ApplicationCommandOptionType, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Pagination } from "../../utils/Pagination";

const CHUNK_SIZE = 10;

export default class ListCommand extends Command {
	constructor() {
		super({
			name: "list",
			description: {
				content: "Browse server members and resources",
				examples: ["list members", "list boosters", "list emojis", "list roles", "list bots", "list bans"],
				usage: "list <subcommand>",
			},
			category: "utils",
			aliases: ["ls"],
			cooldown: 5,
			args: true,
			player: { voice: false, active: false },
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
			slashCommand: true,
			options: [
				{
					name: "members",
					description: "List server members",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{ name: "query", description: "Filter members by name or role", type: ApplicationCommandOptionType.String, required: false },
					],
				},
				{
					name: "boosters",
					description: "List server boosters",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "emojis",
					description: "List server emojis",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "roles",
					description: "List server roles",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "bots",
					description: "List server bots",
					type: ApplicationCommandOptionType.Subcommand,
				},
				{
					name: "bans",
					description: "List banned members",
					type: ApplicationCommandOptionType.Subcommand,
				},
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const subcommand = ctx.isInteraction
			? ctx.interaction!.options.getSubcommand(true)
			: (ctx.args[0]?.toLowerCase() ?? "members");

		switch (subcommand) {
			case "members":
				return this.listMembers(ctx);
			case "boosters":
				return this.listBoosters(ctx);
			case "emojis":
				return this.listEmojis(ctx);
			case "roles":
				return this.listRoles(ctx);
			case "bots":
				return this.listBots(ctx);
			case "bans":
				return this.listBans(ctx);
			default:
				return ctx.editOrReply({
					embeds: [new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setTitle("Invalid Subcommand")
						.setDescription("Valid subcommands: `members`, `boosters`, `emojis`, `roles`, `bots`, `bans`")],
				});
		}
	}

	private async listMembers(ctx: Context): Promise<any> {
		const members = [...ctx.guild.members.cache.values()];
		const query = ctx.isInteraction
			? ctx.interaction!.options.getString("query", false)?.toLowerCase()
			: ctx.args.slice(1).join(" ").toLowerCase();

		let filtered = members;
		if (query) {
			filtered = members.filter((m) =>
				m.user.username.toLowerCase().includes(query) ||
				m.displayName.toLowerCase().includes(query) ||
				m.roles.cache.some((r) => r.name.toLowerCase().includes(query)),
			);
		}

		if (filtered.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription(query ? `No members found matching "${query}".` : "No members found in this server.")],
			});
		}

		// Escape Discord markdown in usernames
		const safeName = (name: string) => name.replace(/[*_~`|\\]/g, "\\$&");

		const embeds = this.buildEmbeds(ctx, filtered, (m) =>
			`${m} - \\\`${safeName(m.user.id)}\\\``,
			`Members (${filtered.length})${query ? ` matching "${query}"` : ""}`,
		);

		return this.sendPaginated(ctx, embeds);
	}

	private async listBoosters(ctx: Context): Promise<any> {
		const boosters = [...ctx.guild.members.cache.values()].filter((m) => m.premiumSince);

		if (boosters.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("No server boosters found.")],
			});
		}

		const embeds = this.buildEmbeds(ctx, boosters, (m) =>
			`${m} - Boosting since ${m.premiumSince?.toLocaleDateString() ?? "unknown"}`,
			`Server Boosters (${boosters.length})`,
		);

		return this.sendPaginated(ctx, embeds);
	}

	private async listEmojis(ctx: Context): Promise<any> {
		const emojis = [...ctx.guild.emojis.cache.values()];

		if (emojis.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("No emojis found in this server.")],
			});
		}

		const embeds = this.buildEmbeds(ctx, emojis, (e) =>
			`${e} - \\\`${e.animated ? "<a:" : "<:"}${e.name}:${e.id}>\\\``,
			`Server Emojis (${emojis.length})`,
		);

		return this.sendPaginated(ctx, embeds);
	}

	private async listRoles(ctx: Context): Promise<any> {
		const roles = [...ctx.guild.roles.cache
			.sort((a, b) => b.position - a.position)
			.values()]
			.filter((r) => r.id !== ctx.guild.id);

		if (roles.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("No roles found in this server.")],
			});
		}

		const embeds = this.buildEmbeds(ctx, roles, (r) =>
			`${r} - \\\`${r.id}\\\` (${r.members.size} members)`,
			`Server Roles (${roles.length})`,
		);

		return this.sendPaginated(ctx, embeds);
	}

	private async listBots(ctx: Context): Promise<any> {
		const bots = [...ctx.guild.members.cache.values()].filter((m) => m.user.bot);

		if (bots.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("No bots found in this server.")],
			});
		}

		const embeds = this.buildEmbeds(ctx, bots, (m) =>
			`${m} - \\\`${m.user.id}\\\``,
			`Bots (${bots.length})`,
		);

		return this.sendPaginated(ctx, embeds);
	}

	private async listBans(ctx: Context): Promise<any> {
		if (!ctx.member?.permissions.has("BanMembers")) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("You need the **Ban Members** permission to view bans.")],
			});
		}

		try {
			const bans = await ctx.guild.bans.fetch();
			const banArray = [...bans.values()];

			if (banArray.length === 0) {
				return ctx.editOrReply({
					embeds: [new EmbedBuilder()
						.setColor(ctx.client.config.colors.main)
						.setDescription("No bans found in this server.")],
				});
			}

			const safeReason = (reason: string | null | undefined) =>
				reason ? reason.replace(/[*_~`|\\]/g, "\\$&").slice(0, 500) : "No reason provided";

			const embeds = this.buildEmbeds(ctx, banArray, (b) =>
				`**${b.user.tag}** (\\\`${b.user.id}\\\`)\nReason: ${safeReason(b.reason)}`,
				`Banned Members (${banArray.length})`,
			);

			return this.sendPaginated(ctx, embeds);
		} catch {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("I don't have permission to view bans, or an error occurred.")],
			});
		}
	}

	private buildEmbeds<T>(
		ctx: Context,
		items: T[],
		format: (item: T) => string,
		title: string,
	): EmbedBuilder[] {
		const embeds: EmbedBuilder[] = [];
		for (let i = 0; i < items.length; i += CHUNK_SIZE) {
			const chunk = items.slice(i, i + CHUNK_SIZE);
			const page = Math.floor(i / CHUNK_SIZE) + 1;
			const totalPages = Math.ceil(items.length / CHUNK_SIZE);
			const desc = chunk.map(format).join("\n");

			// Respect Discord embed field limits (1024 chars per field, 6000 total)
			const safeDesc = desc.length > 4096 ? `${desc.slice(0, 4093)}...` : desc;

			embeds.push(new EmbedBuilder()
				.setColor(ctx.client.config.colors.main)
				.setTitle(title)
				.setDescription(safeDesc)
				.setFooter({ text: `Page ${page}/${totalPages} • ${items.length} total` }));
		}
		return embeds;
	}

	private async sendPaginated(ctx: Context, embeds: EmbedBuilder[]): Promise<any> {
		if (embeds.length === 0) {
			return ctx.editOrReply({
				embeds: [new EmbedBuilder()
					.setColor(ctx.client.config.colors.main)
					.setDescription("No results found.")],
			});
		}

		if (embeds.length === 1) {
			return ctx.editOrReply({ embeds: [embeds[0]!] });
		}

		const pagination = new Pagination(ctx, embeds);
		return pagination.start();
	}
}
