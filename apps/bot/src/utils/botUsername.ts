export const MIN_BOT_USERNAME_LENGTH = 2;
export const MAX_BOT_USERNAME_LENGTH = 32;

export type BotUsernameValidation =
	| { ok: true; username: string }
	| { ok: false; reason: string };

/** Validate a global Discord bot username before calling the Discord API. */
export function validateBotUsername(rawUsername: string): BotUsernameValidation {
	const username = rawUsername.trim();
	const length = Array.from(username).length;

	if (!username) {
		return { ok: false, reason: "Provide a new username. Usage: `?rename <new username>`." };
	}
	if (length < MIN_BOT_USERNAME_LENGTH || length > MAX_BOT_USERNAME_LENGTH) {
		return { ok: false, reason: `The username must be ${MIN_BOT_USERNAME_LENGTH}-${MAX_BOT_USERNAME_LENGTH} characters long.` };
	}
	if (/[\u0000-\u001f\u007f]/u.test(username)) {
		return { ok: false, reason: "The username cannot contain control characters or line breaks." };
	}
	if (/[@#`:]/u.test(username)) {
		return { ok: false, reason: "The username cannot contain `@`, `#`, backticks, or colons." };
	}

	return { ok: true, username };
}
