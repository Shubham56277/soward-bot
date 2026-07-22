import { ButtonBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";

let installed = false;

/** Enforces the bot-wide visual policy without requiring every feature to repeat it. */
export function installUiPolicy(): void {
	if (installed) return;
	installed = true;

	stripEmojiFromJson(ButtonBuilder.prototype);
	stripEmojiFromJson(StringSelectMenuBuilder.prototype, true);
	stripEmojiFromJson(StringSelectMenuOptionBuilder.prototype);
}

function stripEmojiFromJson(prototype: { toJSON: (...args: any[]) => any }, recursive = false): void {
	const original = prototype.toJSON;
	prototype.toJSON = function (...args: any[]) {
		const json = original.apply(this, args);
		if (recursive) removeEmojiFields(json);
		else if (json && typeof json === "object") delete json.emoji;
		return json;
	};
}

function removeEmojiFields(value: unknown): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) removeEmojiFields(item);
		return;
	}
	const record = value as Record<string, unknown>;
	delete record.emoji;
	for (const child of Object.values(record)) removeEmojiFields(child);
}
