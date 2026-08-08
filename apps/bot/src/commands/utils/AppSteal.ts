import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { env } from "@repo/env";

export default class AppStealCommand extends Command {
	constructor() {
		super({
			name: "appsteal",
			description: {
				content: "Upload an emoji to the bot's application (Developer Portal emojis)",
				examples: ["appsteal :emoji:", "appsteal :emoji: customname"],
				usage: "appsteal <emoji> [name]",
			},
			category: "utils",
			cooldown: 10,
			args: true,
			permissions: {
				dev: true,
				client: ["SendMessages"],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const rawContent = ctx.message?.content || "";

		// Parse custom emoji from the message
		const emojiMatch = rawContent.match(/<(a?):(\w+):(\d+)>/);
		if (!emojiMatch) {
			return ctx.sendMessage("Provide a custom emoji to upload to the application.\nUsage: `appsteal :emoji: [name]`");
		}

		const animated = emojiMatch[1] === "a";
		const originalName = emojiMatch[2]!;
		const emojiId = emojiMatch[3]!;
		const customName = ctx.args[1] || originalName;
		const ext = animated ? "gif" : "png";
		const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=256&quality=lossless`;

		// Fetch the emoji image
		const { fetch } = await import("undici");
		const response = await fetch(url);
		if (!response.ok) {
			return ctx.sendMessage(`Failed to fetch emoji image (HTTP ${response.status})`);
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		const base64 = buffer.toString("base64");
		const mimeType = animated ? "image/gif" : "image/png";
		const dataUri = `data:${mimeType};base64,${base64}`;

		// Upload to Discord Application Emojis via REST API
		const appId = env.DISCORD_APP_CLIENT_ID;
		if (!appId) {
			return ctx.sendMessage("DISCORD_APP_CLIENT_ID is not configured in .env");
		}

		try {
			const result = await ctx.client.rest.post(`/applications/${appId}/emojis`, {
				body: {
					name: customName,
					image: dataUri,
				},
			}) as any;

			return ctx.sendMessage(
				`Uploaded **${result.name}** to application emojis.\n` +
				`ID: \`${result.id}\`\n` +
				`Use in select menus: \`<:${result.name}:${result.id}>\`\n` +
				`-# This emoji now works in buttons, select menus, and reactions globally.`
			);
		} catch (e: any) {
			const errorMsg = e?.rawError?.message || e?.message || "Unknown error";
			return ctx.sendMessage(`Failed to upload: ${errorMsg}`);
		}
	}
}
