import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { ProfileBadges, UserProfile, type UserProfileData } from "@repo/db";
import { ProfileBadgeService } from "../src/services/profile/ProfileBadgeService.ts";
import {
	buildProfileRenderCacheKey,
	OUTPUT_POLICY_VERSION,
	preferredProfileFormat,
	profileAttachmentName,
	profileBioDigest,
	profileFallbackCacheTtl,
	ProfileCardRenderer,
	resolveProfileBio,
	sanitizeProfileText,
	type ProfileCardRenderInput,
} from "../src/services/profile/ProfileCardRenderer.ts";
import { isAnimatedDiscordAsset, isOfficialDiscordAssetUrl, ProfileAssetLoader } from "../src/services/profile/ProfileAssetLoader.ts";
import { AnimationGate, animationPlans, expectedRgbaBytes, selectTimelineFrameIndex } from "../src/services/profile/ProfileAnimationCodec.ts";
import { acquireProfileAnimationLease } from "../src/services/profile/ProfileAnimationLease.ts";
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


describe("profile animation adaptive plans", () => {
	it("uses the approved avatar, banner, and retry quality ladder", () => {
		const avatar = animationPlans(false);
		assert.deepEqual(avatar[0], { width: 960, height: 540, fps: 15, duration: 3, frames: 45, colors: 128 });
		assert.deepEqual(avatar[1], { width: 800, height: 450, fps: 10, duration: 2.4, frames: 24, colors: 96 });
		const banner = animationPlans(true);
		assert.deepEqual(banner[0], { width: 900, height: 506, fps: 12, duration: 3, frames: 36, colors: 128 });
		assert.equal(banner[1], avatar[1]);
	});

	it("enforces the RGBA contract and selects nearest retry samples from the primary timeline", () => {
		assert.equal(expectedRgbaBytes(960, 540), 960 * 540 * 4);
		assert.deepEqual(
			Array.from({ length: 4 }, (_, index) => selectTimelineFrameIndex(index, 10, 15, 45)),
			[0, 2, 3, 5],
		);
		assert.equal(selectTimelineFrameIndex(23, 10, 15, 45), 35);
	});
});

describe("finite profile animation gate", () => {
	it("bounds active and queued work and makes release idempotent", async () => {
		const gate = new AnimationGate(1, 1, 100);
		const first = await gate.acquire();
		assert.ok(first);
		const secondPending = gate.acquire();
		assert.equal(await gate.acquire(), null);
		assert.deepEqual(gate.snapshot(), { active: 1, queued: 1 });
		first();
		const second = await secondPending;
		assert.ok(second);
		first();
		assert.deepEqual(gate.snapshot(), { active: 1, queued: 0 });
		second();
		second();
		assert.deepEqual(gate.snapshot(), { active: 0, queued: 0 });
	});

	it("times out queued work without leaking capacity", async () => {
		const gate = new AnimationGate(1, 1, 10);
		const release = await gate.acquire();
		assert.ok(release);
		assert.equal(await gate.acquire(), null);
		assert.deepEqual(gate.snapshot(), { active: 1, queued: 0 });
		release();
		assert.deepEqual(gate.snapshot(), { active: 0, queued: 0 });
	});
});

class FakeRedis {
	public readonly values = new Map<string, string>();
	public async set(key: string, value: string): Promise<"OK" | null> {
		if (this.values.has(key)) return null;
		this.values.set(key, value);
		return "OK";
	}
	public async eval(_script: string, _keys: number, key: string, token: string): Promise<number> {
		if (this.values.get(key) !== token) return 0;
		this.values.delete(key);
		return 1;
	}
}

describe("distributed profile animation slots", () => {
	it("uses two slots and releases only the matching token", async () => {
		const redis = new FakeRedis();
		const first = await acquireProfileAnimationLease(redis as any, "request-a");
		const second = await acquireProfileAnimationLease(redis as any, "request-b");
		assert.ok(first);
		assert.ok(second);
		assert.equal(await acquireProfileAnimationLease(redis as any, "request-c"), null);
		redis.values.set("profile:animation:slot:0", "replacement-token");
		await first();
		assert.equal(redis.values.get("profile:animation:slot:0"), "replacement-token");
		await second();
		assert.equal(redis.values.has("profile:animation:slot:1"), false);
	});
});

describe("profile animation fallback cache policy", () => {
	it("uses a new output policy and short-lived transient PNG fallback caching", () => {
		assert.equal(OUTPUT_POLICY_VERSION, "profile-card-v4-raw-rgba");
		assert.equal(profileFallbackCacheTtl(true), 7_500);
		assert.equal(profileFallbackCacheTtl(false), 90_000);
		assert.match(buildProfileRenderCacheKey(renderInput("versioned")), /^profile-card-v4-raw-rgba\|/);
	});
});

describe("profile asset byte LRU", () => {
	it("accounts bytes, evicts by byte limit, and gives failures a short negative TTL", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "profile-assets-test-"));
		let now = 1_000;
		const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]);
		try {
			await writeFile(path.join(root, "one.png"), image);
			await writeFile(path.join(root, "two.png"), image);
			const loader = new ProfileAssetLoader(root, {
				maxBytes: image.length + 1,
				maxEntries: 4,
				successTtlMs: 1_000,
				negativeTtlMs: 10,
				now: () => now,
			});
			assert.deepEqual(await loader.loadBadge({ kind: "local", path: "one.png" }), image);
			assert.deepEqual(await loader.loadBadge({ kind: "local", path: "two.png" }), image);
			assert.deepEqual(loader.cacheState(), { entries: 1, bytes: image.length });
			assert.equal(await loader.loadBadge({ kind: "local", path: "later.png" }), null);
			await writeFile(path.join(root, "later.png"), image);
			assert.equal(await loader.loadBadge({ kind: "local", path: "later.png" }), null);
			now += 11;
			assert.deepEqual(await loader.loadBadge({ kind: "local", path: "later.png" }), image);
			assert.ok(loader.cacheState().bytes <= image.length + 1);
			loader.clear();
			assert.deepEqual(loader.cacheState(), { entries: 0, bytes: 0 });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
