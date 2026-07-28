import ms from "@lukeed/ms";
import { User } from "@repo/db";
import { env } from "@repo/env";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { SETTINGS_FLAGS, settingsFailure, settingsPanel } from "../../utils/botSettingsUi";
import { TimeFormat } from "../../utils/timeFormat";

const MAX_LIST = 30;
// Never ping users when rendering the list or notices.
const NO_PING = { parse: [] as const };

/**
 * No-prefix access management.
 *
 * Two-tier model:
 *  - Developers GRANT access with `add <user> [duration]` / `remove <user>`.
 *  - A granted member then toggles it themselves with `enable`/`disable`.
 *
 * Premium, shown under Bot Settings. Developers bypass every restriction.
 */
export default class NoPrefix extends Command {
	public constructor() {
		super({
			name: "noprefix",
			description: {
				content: "Manage no-prefix access",
				usage: "noprefix <add|remove|enable|disable|list|reset> [user] [duration]",
				examples: ["noprefix", "noprefix add @user", "noprefix add @user 30d", "noprefix remove @user", "np enable", "np disable", "np list", "np reset"],
			},
			category: "botSettings",
			premium: true,
			cooldown: 5,
			slashCommand: false,
			permissions: { dev: false, client: ["SendMessages", "ViewChannel", "EmbedLinks"], user: [] },
		});
	}

	public async run(ctx: Context): Promise<any> {
		try {
			const action = (ctx.args[0] ?? "").toLowerCase();
			if (!action) return this.dashboard(ctx);

			switch (action) {
				case "add":
				case "grant":
					return this.grant(ctx);
				case "remove":
				case "revoke":
					return this.revoke(ctx);
				case "enable":
				case "on":
					return this.toggle(ctx, true);
				case "disable":
				case "off":
					return this.toggle(ctx, false);
				case "list":
					return this.list(ctx);
				case "reset":
					return this.reset(ctx);
				default:
					return this.dashboard(ctx);
			}
		} catch (error) {
			return settingsFailure(ctx, error, "noprefix");
		}
	}

	// ─── Access management (owner / developer only) ─────────────────────────

	private async grant(ctx: Context): Promise<any> {
		if (!this.isManager(ctx)) return this.denyManager(ctx);
		const user = ctx.options.getUser("user", false, 1);
		if (!user) return this.notice(ctx, "User required", "Mention a member or provide a valid user ID. Usage: `noprefix add <user> [duration]`.");
		if (user.bot) return this.notice(ctx, "Invalid user", "Bots cannot be granted no-prefix access.");

		// Optional duration such as 30d, 12h, 45m, 1y. Omit for permanent access.
		const rawDuration = ctx.args[2];
		let durationMs: number | undefined;
		if (rawDuration) {
			const parsed = ms.parse(rawDuration);
			if (!parsed || parsed <= 0) {
				return this.notice(ctx, "Invalid duration", "Use a duration like `30d`, `12h`, `45m`, or `1y`. Omit it for permanent access.");
			}
			durationMs = parsed;
		}

		await User.grantNoPrefixAccess(user.id, durationMs);
		const window = durationMs ? ` for **${TimeFormat.toHumanize(durationMs)}** (until <t:${Math.floor((Date.now() + durationMs) / 1_000)}:R>)` : " **permanently**";
		return this.notice(ctx, "Access granted", `${this.tag(user.id)} can now use no-prefix${window}. They enable it with \`np enable\` and turn it off with \`np disable\`.`);
	}

	private async revoke(ctx: Context): Promise<any> {
		if (!this.isManager(ctx)) return this.denyManager(ctx);
		const user = ctx.options.getUser("user", false, 1);
		if (!user) return this.notice(ctx, "User required", "Mention a member or provide a valid user ID. Usage: `noprefix remove <user>`.");

		if (!(await User.isNoPrefixAllowed(user.id))) {
			return this.notice(ctx, "Not granted", `${this.tag(user.id)} does not have no-prefix access.`);
		}
		await User.revokeNoPrefixAccess(user.id);
		return this.notice(ctx, "Access removed", `${this.tag(user.id)} can no longer use no-prefix, and it has been turned off.`);
	}

	// ─── Self toggle (granted members) ──────────────────────────────────────

	private async toggle(ctx: Context, enable: boolean): Promise<any> {
		const isDev = this.isDev(ctx);
		const allowed = isDev || (await User.isNoPrefixAllowed(ctx.author!.id));
		if (!allowed) {
			return this.notice(ctx, "No access", "You do not have no-prefix access. Ask a bot developer to grant it with `noprefix add`.");
		}
		await User.setNoPrefixEnabled(ctx.author!.id, enable);
		return this.notice(
			ctx,
			enable ? "No-prefix enabled" : "No-prefix disabled",
			enable ? "You can now run commands without a prefix. Use `np disable` to turn it off." : "You will now need a prefix again. Use `np enable` to turn it back on.",
		);
	}

	// ─── List / reset (owner / developer only) ──────────────────────────────

	private async list(ctx: Context): Promise<any> {
		if (!this.isManager(ctx)) return this.denyManager(ctx);
		const entries = await User.getAllNoPrefix();
		if (!entries.length) return this.notice(ctx, "No-prefix access", "No members have no-prefix access yet. Grant it with `noprefix add <user>`.");

		const shown = entries.slice(0, MAX_LIST);
		const lines = shown.map((entry) => {
			const state = entry.enabled ? "on" : "off";
			const expiry = entry.expiresAt ? `expires <t:${Math.floor(entry.expiresAt.getTime() / 1_000)}:R>` : "permanent";
			return `${this.tag(entry.userId)} — ${state} · ${expiry}`;
		});
		const extra = entries.length > shown.length ? `\n-# and ${entries.length - shown.length} more` : "";
		return this.send(ctx, settingsPanel("No-prefix access", `${entries.length} member${entries.length === 1 ? "" : "s"} with access.`, [["Members", `${lines.join("\n")}${extra}`]]));
	}

	private async reset(ctx: Context): Promise<any> {
		if (!this.isManager(ctx)) return this.denyManager(ctx);
		const count = await User.resetAllNoPrefix();
		if (!count) return this.notice(ctx, "Nothing to reset", "No members currently have no-prefix access.");
		return this.notice(ctx, "No-prefix reset", `Removed no-prefix access from **${count}** member${count === 1 ? "" : "s"}.`);
	}

	// ─── Dashboard ──────────────────────────────────────────────────────────

	private async dashboard(ctx: Context): Promise<any> {
		const manager = this.isManager(ctx);
		const entries = manager ? await User.getAllNoPrefix() : [];
		const active = entries.filter((entry) => entry.enabled);

		const sections: Array<[string, string]> = [];
		if (manager) {
			const holders = active.length ? active.slice(0, MAX_LIST).map((entry) => this.tag(entry.userId)).join("  ") : "No members currently have no-prefix on.";
			sections.push(["Currently on", holders]);
			sections.push(["Add", "`noprefix add <user> [duration]`\nGrant access. Duration like `30d`, `12h`, `1y`; omit for permanent."]);
			sections.push(["Remove", "`noprefix remove <user>`\nRevoke a member's access."]);
			sections.push(["List", "`noprefix list`\nShow everyone with access, status, and expiry."]);
			sections.push(["Reset", "`noprefix reset`\nRevoke access from everyone."]);
		}
		sections.push(["Enable", "`np enable`\nTurn no-prefix on for yourself (requires access)."]);
		sections.push(["Disable", "`np disable`\nTurn no-prefix off for yourself."]);

		const description = manager
			? "Grant trusted members the ability to run commands without a prefix, then they toggle it themselves. Only developers can grant access."
			: "Run commands without a prefix once a bot developer grants you access.";
		return this.send(ctx, settingsPanel("No-prefix access", description, sections));
	}

	// ─── Helpers ────────────────────────────────────────────────────────────

	private isDev(ctx: Context): boolean {
		return env.DEVELOPER_IDS.includes(ctx.author!.id);
	}

	private isManager(ctx: Context): boolean {
		return this.isDev(ctx);
	}

	/** Renders a user reference that never triggers a ping. */
	private tag(userId: string): string {
		return `<@${userId}>`;
	}

	private denyManager(ctx: Context): Promise<any> {
		return this.notice(ctx, "Developers only", "Only bot developers can grant or manage no-prefix access.");
	}

	private notice(ctx: Context, title: string, body: string): Promise<any> {
		return this.send(ctx, settingsPanel(title, body));
	}

	private send(ctx: Context, panel: ReturnType<typeof settingsPanel>): Promise<any> {
		return ctx.sendMessage({ components: [panel], flags: SETTINGS_FLAGS, allowedMentions: NO_PING });
	}
}
