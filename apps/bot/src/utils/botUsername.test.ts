import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_BOT_USERNAME_LENGTH, MIN_BOT_USERNAME_LENGTH, validateBotUsername } from "./botUsername";

describe("validateBotUsername", () => {
	it("trims and accepts a valid multi-word bot username", () => {
		assert.deepEqual(validateBotUsername("  Elfaria Bot  "), { ok: true, username: "Elfaria Bot" });
	});

	it("rejects missing, short, and overlong usernames", () => {
		assert.equal(validateBotUsername("").ok, false);
		assert.equal(validateBotUsername("x").ok, false);
		assert.equal(validateBotUsername("x".repeat(MAX_BOT_USERNAME_LENGTH + 1)).ok, false);
	});

	it("rejects control characters and Discord-sensitive punctuation", () => {
		for (const username of ["Elfaria\nBot", "Elfaria@Bot", "Elfaria#Bot", "Elfaria:Bot", "Elfaria`Bot"]) {
			assert.equal(validateBotUsername(username).ok, false, username);
		}
	});

	it("accepts every generated safe username within Discord length bounds", () => {
		const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_. -";
		let state = 0x5eed1234;
		const next = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state;
		};

		for (let sample = 0; sample < 200; sample++) {
			const length = MIN_BOT_USERNAME_LENGTH + (next() % (MAX_BOT_USERNAME_LENGTH - MIN_BOT_USERNAME_LENGTH + 1));
			let username = "A";
			while (Array.from(username).length < length) username += alphabet[next() % alphabet.length];
			username = `${username.slice(0, -1)}Z`;
			const result = validateBotUsername(username);
			assert.equal(result.ok, true, JSON.stringify(username));
			if (result.ok) assert.equal(result.username, username);
		}
	});

	it("rejects every generated username outside Discord length bounds", () => {
		for (let length = 0; length < MIN_BOT_USERNAME_LENGTH; length++) {
			assert.equal(validateBotUsername("x".repeat(length)).ok, false);
		}
		for (let length = MAX_BOT_USERNAME_LENGTH + 1; length <= MAX_BOT_USERNAME_LENGTH + 20; length++) {
			assert.equal(validateBotUsername("x".repeat(length)).ok, false);
		}
	});
});
