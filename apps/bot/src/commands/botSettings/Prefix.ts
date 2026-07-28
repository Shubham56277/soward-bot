import { Guild } from "@repo/db";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { validatePrefix } from "../../utils/botSettingsValidation";
import { invalidatePrefixCache } from "../../utils/commandStateCache";

const MAX_PREFIXES = 5;

const prefixValueOption = (name: "set" | "add" | "remove", description: string): any => ({
	name,
	description,
	type: ApplicationCommandOptionType.Subcommand,
	options: [{ name: "value", description: "A 1-5 character prefix without spaces", type: ApplicationCommandOptionType.String, required: true, min_length: 1, max_length: 5 }],
});

export default class Prefix extends Command {
	public constructor() {
		super({
			name: "prefix",
			description: {
				content: "Manage command prefixes for this server",
				usage: "prefix <show|set|add|remove|reset> [prefix]",
				examples: ["prefix show", "prefix set !", "prefix add ?", "prefix remove ?", "prefix reset"],
			},
			cooldown: 3,
			permissions: {
				dev: false,
				client: ["SendMessages", "ViewChannel", "EmbedLinks"],
				user: [PermissionFlagsBits.Administrator],
			},
			slashCommand: true,
			options: [
				{ name: "show", description: "Show active prefixes", type: ApplicationCommandOptionType.Subcommand },
				prefixValueOption("set", "Replace all prefixes with one primary prefix"),
				prefixValueOption("add", "Add another accepted prefix"),
				prefixValueOption("remove", "Remove an accepted prefix"),
				{ name: "reset", description: "Restore the default prefix", type: ApplicationCommandOptionType.Subcommand },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			// `?prefix` with no subcommand shows the full dashboard (current prefixes + subcommands).
			const rawAction = ctx.options.getSubCommand(false, 0);
			if (!rawAction) return this.dashboard(ctx);

			const action = rawAction.toLowerCase();
			if (action === "reset") return this.save(ctx, [ctx.client.config.prefix], "Default prefix restored");
			if (action === "show") return this.show(ctx);
			if (!["set", "add", "remove"].includes(action)) return this.dashboard(ctx);

			const raw = ctx.isInteraction ? ctx.options.getString("value", true) : ctx.args[1];
			if (!raw) return this.notice(ctx, "Prefix required", `Provide a prefix after \`${action}\`.`);
			const value = validatePrefix(raw);
			if (!value) return this.notice(ctx, "Invalid prefix", "Use 1-5 visible characters. Spaces, slash commands, mentions, formatting marks, and control characters are not supported.");

			const record = await Guild.get(ctx.guild.id);
			const current = [...new Set([record?.prefix ?? ctx.client.config.prefix, ...(record?.prefixes ?? [])])];
			if (action === "set") return this.save(ctx, [value], "Primary prefix updated");
			if (action === "add") {
				if (current.includes(value)) return this.show(ctx, `\`${value}\` is already active.`);
				if (current.length >= MAX_PREFIXES) return this.show(ctx, `This server can use at most ${MAX_PREFIXES} prefixes.`);
				return this.save(ctx, [...current, value], "Prefix added");
			}
			if (!current.includes(value)) return this.show(ctx, `\`${value}\` is not active.`);
			if (current.length === 1) return this.show(ctx, "You cannot remove the only prefix. Set another one or reset first.");
			return this.save(
				ctx,
				current.filter((prefix) => prefix !== value),
				"Prefix removed",
			);
		} catch (error) {
			return settingsFailure(ctx, error, "prefix");
		}
	}
	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return ctx.sendMessage({ components: [settingsPanel(title, body)], flags: SETTINGS_FLAGS });
	}

	private async dashboard(ctx: Context): Promise<any> {
		const record = await Guild.get(ctx.guild.id);
		const prefixes = [...new Set([record?.prefix ?? ctx.client.config.prefix, ...(record?.prefixes ?? [])])];
		return ctx.sendMessage({
			components: [
				settingsPanel("Prefix settings", `Manage the command prefixes accepted in **${ctx.guild.name}**. You can use up to ${MAX_PREFIXES} prefixes.`, [
					["Active prefixes", prefixes.map((prefix) => `\`${prefix}\``).join("  ")],
					["Show", "`prefix show`\nList every prefix accepted in this server."],
					["Set", "`prefix set <value>`\nReplace all prefixes with one primary prefix."],
					["Add", "`prefix add <value>`\nAdd another accepted prefix."],
					["Remove", "`prefix remove <value>`\nRemove an accepted prefix."],
					["Reset", "`prefix reset`\nRestore the default prefix."],
					["Mention fallback", `You can always use <@${ctx.client.user?.id}> before a command.`],
				]),
			],
			flags: SETTINGS_FLAGS,
		});
	}

	private async save(ctx: Context, prefixes: string[], title: string): Promise<any> {
		await Guild.update(ctx.guild.id, { prefix: prefixes[0]!, prefixes });
		invalidatePrefixCache(ctx.guild.id);
		return ctx.sendMessage({
			components: [settingsPanel(title, "Prefix changes apply immediately in this server.", [["Active prefixes", prefixes.map((prefix) => `\`${prefix}\``).join("  ")]])],
			flags: SETTINGS_FLAGS,
		});
	}

	private async show(ctx: Context, note?: string): Promise<any> {
		const record = await Guild.get(ctx.guild.id);
		const prefixes = [...new Set([record?.prefix ?? ctx.client.config.prefix, ...(record?.prefixes ?? [])])];
		return ctx.sendMessage({
			components: [
				settingsPanel("Server prefixes", note ?? "Every prefix below is accepted in this server.", [
					["Primary", `\`${prefixes[0]}\``],
					["All accepted", prefixes.map((prefix) => `\`${prefix}\``).join("  ")],
					["Mention fallback", `You can always use <@${ctx.client.user?.id}> before a command.`],
				]),
			],
			flags: SETTINGS_FLAGS,
		});
	}
}
