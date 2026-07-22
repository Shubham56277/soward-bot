import { MessagePayload } from "discord.js";

/** Discord's `-#` syntax renders a line as compact subtext. */
export function compactReplyText(text: string): string {
	if (!text.trim() || text.includes("```")) return text;

	return text
		.split("\n")
		.map((line) => {
			if (!line.trim() || line.trimStart().startsWith("-#")) return line;
			return `-# ${line}`;
		})
		.join("\n");
}

/** Adds compact styling to string/plain-object content without touching embeds or files. */
export function compactReply<T>(value: T): T {
	if (typeof value === "string") return compactReplyText(value) as T;
	if (!value || typeof value !== "object" || value instanceof MessagePayload) return value;

	const payload = value as Record<string, unknown>;
	if (typeof payload.content !== "string") return value;
	return { ...payload, content: compactReplyText(payload.content) } as T;
}

