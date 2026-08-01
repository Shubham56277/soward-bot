import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAnimatedDiscordAsset, isOfficialDiscordAssetUrl, ProfileAssetLoader } from "../src/services/profile/ProfileAssetLoader.ts";
import { sanitizeProfileText } from "../src/services/profile/ProfileCardRenderer.ts";

describe("profile text safety", () => {
	it("neutralizes mentions, markdown, controls, and excessive length", () => {
		const value = sanitizeProfileText("@everyone **hello**\u0000".repeat(20), 32);
		assert.equal(value.includes("@everyone"), false);
		assert.equal(value.includes("**"), false);
		assert.equal(value.includes("\u0000"), false);
		assert.ok(Array.from(value).length <= 32);
	});
});

describe("official Discord asset validation", () => {
	it("accepts only HTTPS Discord CDN/media URLs", () => {
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com/avatars/123/avatar.png"), true);
		assert.equal(isOfficialDiscordAssetUrl("https://media.discordapp.net/attachments/1/2/image.png"), true);
		assert.equal(isOfficialDiscordAssetUrl("http://cdn.discordapp.com/avatar.png"), false);
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com.evil.example/avatar.png"), false);
		assert.equal(isOfficialDiscordAssetUrl("not a URL"), false);
		assert.equal(isAnimatedDiscordAsset("a_animatedhash"), true);
		assert.equal(isAnimatedDiscordAsset("https://cdn.discordapp.com/avatar.gif?size=1024"), true);
		assert.equal(isAnimatedDiscordAsset("static_hash"), false);
	});
});

describe("profile asset loader", () => {
	it("rejects unsafe local and non-Discord remote sources without throwing", async () => {
		const loader = new ProfileAssetLoader();
		assert.equal(await loader.loadDiscord("https://example.com/avatar.png"), null);
		assert.equal(await loader.loadBadge({ kind: "local", path: "images/../.env" }), null);
		assert.equal(await loader.loadBadge("http://example.com/badge.png"), null);
	});
});
