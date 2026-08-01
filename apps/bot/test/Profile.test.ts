import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { ProfileBadges, UserProfile, type UserProfileData } from "@repo/db";
import { ProfileBadgeService } from "../src/services/profile/ProfileBadgeService.ts";
import {
	buildProfileRenderCacheKey,
	preferredProfileFormat,
	profileAttachmentName,
	profileBioDigest,
	ProfileCardRenderer,
	resolveProfileBio,
	sanitizeProfileText,
	type ProfileCardRenderInput,
} from "../src/services/profile/ProfileCardRenderer.ts";
import { isAnimatedDiscordAsset, isOfficialDiscordAssetUrl, ProfileAssetLoader } from "../src/services/profile/ProfileAssetLoader.ts";
import { layoutOfficialBadges, mapOfficialProfileBadges } from "../src/services/profile/OfficialProfileBadges.ts";

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
	it("accepts only expected HTTPS Discord avatar, banner, and fallback paths", () => {
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com/avatars/123456789012345678/avatar.png?size=1024"), true);
		assert.equal(isOfficialDiscordAssetUrl("https://media.discordapp.net/banners/123456789012345678/a_hash.gif?size=512"), true);
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com/embed/avatars/0.png"), true);
		assert.equal(isOfficialDiscordAssetUrl("https://media.discordapp.net/attachments/1/2/image.png"), false);
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com/avatars/123456789012345678/avatar.png?width=400"), false);
		assert.equal(isOfficialDiscordAssetUrl("http://cdn.discordapp.com/avatars/123456789012345678/avatar.png"), false);
		assert.equal(isOfficialDiscordAssetUrl("https://cdn.discordapp.com.evil.example/avatars/123456789012345678/avatar.png"), false);
		assert.equal(isOfficialDiscordAssetUrl("not a URL"), false);
		assert.equal(isAnimatedDiscordAsset("a_animatedhash"), true);
		assert.equal(isAnimatedDiscordAsset("https://cdn.discordapp.com/avatars/123456789012345678/avatar.gif?size=1024"), true);
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

describe("profile badge data loading", () => {
	it("reuses an independently loaded user profile without another profile read", async () => {
		const profile: UserProfileData = {
			userId: "123456789012345678",
			bio: "Saved Elfaria bio",
			badges: [],
			createdAt: new Date("2025-01-01T00:00:00.000Z"),
			updatedAt: new Date("2025-01-02T00:00:00.000Z"),
		};
		mock.method(ProfileBadges, "list", async () => []);
		mock.method(ProfileBadges, "assigned", async () => []);
		const profileGet = mock.method(UserProfile, "get", async () => {
			throw new Error("unexpected duplicate profile read");
		});

		try {
			const view = await new ProfileBadgeService().activeAssigned(profile.userId, 5, profile);
			assert.equal(view.profile, profile);
			assert.equal(view.profile.bio, "Saved Elfaria bio");
			assert.equal(profileGet.mock.callCount(), 0);
		} finally {
			mock.restoreAll();
		}
	});
});

function profileWithBio(bio: string | null): UserProfileData {
	return {
		userId: "123456789012345678",
		bio,
		badges: [],
		createdAt: new Date("2025-01-01T00:00:00.000Z"),
		updatedAt: new Date("2025-01-02T00:00:00.000Z"),
	};
}

function renderInput(bio: string): ProfileCardRenderInput {
	return {
		user: {
			id: "123456789012345678",
			avatar: null,
			banner: null,
			username: "profile-user",
			globalName: "Profile User",
			createdTimestamp: 1_700_000_000_000,
			bot: false,
			displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			bannerURL: () => null,
		} as ProfileCardRenderInput["user"],
		premium: false,
		profile: profileWithBio(bio),
		avatar: "https://cdn.discordapp.com/embed/avatars/0.png",
		avatarHash: "default",
		bannerHash: "none",
	};
}

describe("profile bio render model and cache identity", () => {
	it("uses a saved sanitized bio for a non-premium profile", () => {
		assert.equal(resolveProfileBio(profileWithBio("  Saved **story** @everyone  ")), "Saved story ＠everyone");
		assert.equal(resolveProfileBio(profileWithBio(null)), "No bio set — a quiet story waiting to be written.");
	});

	it("changes the cache key when bio content changes despite an identical timestamp", () => {
		const first = renderInput("First bio");
		const second = renderInput("Second bio");
		assert.notEqual(profileBioDigest(first.profile), profileBioDigest(second.profile));
		assert.notEqual(buildProfileRenderCacheKey(first), buildProfileRenderCacheKey(second));
	});

	it("advances a user's cache generation when invalidated", () => {
		const renderer = new ProfileCardRenderer();
		const input = renderInput("Cached bio");
		const before = renderer.cacheKeyFor(input);
		assert.equal(renderer.invalidateUser(input.user.id), 0);
		assert.notEqual(renderer.cacheKeyFor(input), before);
	});
});

describe("official Discord profile badges", () => {
	it("maps only display flags in stable order and never infers Nitro", () => {
		const enabled = new Set(["ActiveDeveloper", "Staff", "PremiumPromoDismissed", "BugHunterLevel2"]);
		const badges = mapOfficialProfileBadges({ has: (flag) => enabled.has(String(flag)) });
		assert.deepEqual(badges.map((badge) => badge.key), ["staff", "bug-hunter-2", "active-developer"]);
		assert.equal(badges.some((badge) => /nitro/i.test(badge.key + badge.label)), false);
	});

	it("keeps server booster explicit and bounds overflow", () => {
		const enabled = new Set(["Staff", "Partner", "Hypesquad", "BugHunterLevel1"]);
		const badges = mapOfficialProfileBadges({ has: (flag) => enabled.has(String(flag)) }, true);
		assert.equal(badges.at(-1)?.key, "server-booster");
		const layout = layoutOfficialBadges(badges, 100);
		assert.deepEqual(layout.visible.map((badge) => badge.key), ["staff", "partner"]);
		assert.equal(layout.overflow, 3);
	});
});

describe("profile attachment format", () => {
	it("selects and names static PNG and animated GIF outputs", () => {
		assert.equal(preferredProfileFormat(false, false), "png");
		assert.equal(preferredProfileFormat(true, false), "gif");
		assert.equal(preferredProfileFormat(false, true), "gif");
		assert.equal(profileAttachmentName("123", "png"), "elfaria-profile-123.png");
		assert.equal(profileAttachmentName("123", "gif"), "elfaria-profile-123.gif");
	});
});
