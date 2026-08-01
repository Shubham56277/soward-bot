import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "discord.js";
import { buildProfileCard, isOfficialDiscordImageUrl, publicBadgeLabels, sanitizeProfileText } from "./Profile";

const avatarUrl = "https://cdn.discordapp.com/avatars/123/avatar.webp";
const bannerUrl = "https://cdn.discordapp.com/banners/123/banner.webp";

function testUser(): User {
	return {
		id: "123456789012345678",
		username: "user_**name**",
		globalName: "@everyone **Display**",
		bot: false,
		createdTimestamp: 1_700_000_000_000,
		flags: { toArray: () => ["ActiveDeveloper", "Spammer"] },
	} as unknown as User;
}

describe("profile text safety", () => {
	it("neutralizes mentions, markdown, and control characters", () => {
		const value = sanitizeProfileText("@everyone **hello**\u0000");
		assert.equal(value.includes("@everyone"), false);
		assert.equal(value.includes("**hello**"), false);
		assert.equal(value.includes("\u0000"), false);
	});
});

describe("official Discord image validation", () => {
	it("accepts only HTTPS Discord CDN/media URLs", () => {
		assert.equal(isOfficialDiscordImageUrl(avatarUrl), true);
		assert.equal(isOfficialDiscordImageUrl("https://media.discordapp.net/attachments/1/2/image.png"), true);
		assert.equal(isOfficialDiscordImageUrl("http://cdn.discordapp.com/avatar.png"), false);
		assert.equal(isOfficialDiscordImageUrl("https://cdn.discordapp.com.evil.example/avatar.png"), false);
		assert.equal(isOfficialDiscordImageUrl("not a URL"), false);
	});
});

describe("public Discord badges", () => {
	it("maps known official flags and ignores unknown flags", () => {
		assert.deepEqual(publicBadgeLabels(["ActiveDeveloper", "unknown", "BugHunterLevel1"]), ["Active Developer", "Discord Bug Hunter"]);
	});
});

describe("profile card rendering", () => {
	it("omits saved profile content and premium decoration for non-premium users", () => {
		const user = testUser();
		const json = JSON.stringify(
			buildProfileCard({
				user,
				premium: false,
				profile: { bio: "PRIVATE BIO", badges: ["supporter"] },
				avatarUrl,
				bannerUrl: null,
				closeId: "profile_close:test",
			}).toJSON(),
		);
		assert.equal(json.includes(`[${user.id}](https://discord.com/users/${user.id})`), true);
		assert.equal(json.includes("PRIVATE BIO"), false);
		assert.equal(json.includes("Supporter"), false);
		assert.equal(json.includes("1532972816951935066"), false);
		assert.match(json, /Active Developer/);
		for (const forbidden of ["Joined", "Server", "Nickname", "Permissions", "Timeout", "Voice", "Highest Role", "Boost"]) {
			assert.equal(json.includes(forbidden), false, `unexpected guild field: ${forbidden}`);
		}
	});

	it("renders supported premium fields and an official Discord banner", () => {
		const user = testUser();
		const json = JSON.stringify(
			buildProfileCard({
				user,
				premium: true,
				profile: { bio: "Hello **world** @everyone", badges: ["supporter", "unknown"] },
				avatarUrl,
				bannerUrl,
				closeId: "profile_close:test",
			}).toJSON(),
		);
		assert.equal(json.includes(`[${user.id}](https://discord.com/users/${user.id})`), true);
		assert.match(json, /1532972816951935066/);
		assert.match(json, /Supporter/);
		assert.match(json, /Discord banner/);
		assert.equal(json.includes("@everyone"), false);
		assert.equal(json.includes("unknown"), false);
	});
});