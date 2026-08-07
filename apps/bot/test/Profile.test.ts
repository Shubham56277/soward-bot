import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { ProfileBadges, UserProfile, type UserProfileData } from "@repo/db";
import { layoutOfficialBadges, mapOfficialProfileBadges } from "../src/services/profile/OfficialProfileBadges.ts";
import { AnimationGate, animationPlans, expectedRgbaBytes, selectTimelineFrameIndex } from "../src/services/profile/ProfileAnimationCodec.ts";
import { acquireProfileAnimationLease } from "../src/services/profile/ProfileAnimationLease.ts";
import { isAnimatedDiscordAsset, isOfficialDiscordAssetUrl, isPublicProfileAddress, ProfileAssetLoader, type ProfileAssetRemoteResponse } from "../src/services/profile/ProfileAssetLoader.ts";
import { ProfileBadgeService } from "../src/services/profile/ProfileBadgeService.ts";
import {
	buildProfileRenderCacheKey,
	OUTPUT_POLICY_VERSION,
	ProfileCardRenderer,
	type ProfileCardRenderInput,
	preferredProfileFormat,
	profileAttachmentName,
	profileBioDigest,
	profileFallbackCacheTtl,
	resolveProfileBio,
	sanitizeProfileText,
} from "../src/services/profile/ProfileCardRenderer.ts";

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

const TEST_PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]);

type RemoteState = { dumped: boolean; destroyed: boolean; closed: boolean; yielded: number };
function remoteResponse(
	statusCode = 200,
	headers: Record<string, string | string[] | undefined> = {
		"content-type": "image/png",
		"content-length": String(TEST_PNG.length),
	},
	chunks: readonly Buffer[] = [TEST_PNG],
): { response: ProfileAssetRemoteResponse; state: RemoteState } {
	const state: RemoteState = { dumped: false, destroyed: false, closed: false, yielded: 0 };
	return {
		state,
		response: {
			statusCode,
			headers,
			body: {
				async dump() {
					state.dumped = true;
				},
				destroy() {
					state.destroyed = true;
				},
				async *[Symbol.asyncIterator]() {
					for (const chunk of chunks) {
						state.yielded += 1;
						yield chunk;
					}
				},
			},
			async close() {
				state.closed = true;
			},
		},
	};
}

describe("profile asset loader", () => {
	it("rejects unsafe local and non-Discord remote sources without throwing", async () => {
		const loader = new ProfileAssetLoader();
		assert.equal(await loader.loadDiscord("https://example.com/avatar.png"), null);
		assert.equal(await loader.loadBadge({ kind: "local", path: "images/../.env" }), null);
		assert.equal(await loader.loadBadge("http://example.com/badge.png"), null);
	});

	it("hard-bounds unresolved entries instead of allowing unique stalled requests to grow the cache", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const loader = new ProfileAssetLoader(undefined, {
			maxEntries: 2,
			timeoutMs: 100,
			lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			request: async () => {
				await blocked;
				return remoteResponse().response;
			},
		});
		const first = loader.loadBadge("https://one.example/badge.png");
		const second = loader.loadBadge("https://two.example/badge.png");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(loader.cacheState(), { entries: 2, bytes: 0 });
		assert.equal(await loader.loadBadge("https://three.example/badge.png"), null);
		assert.deepEqual(loader.cacheState(), { entries: 2, bytes: 0 });
		release();
		await Promise.all([first, second]);
	});

	it("rejects private, special-use, mapped, translated, and malformed resolved addresses", async () => {
		for (const address of [
			"0.0.0.0",
			"10.0.0.1",
			"100.64.0.1",
			"127.0.0.1",
			"169.254.169.254",
			"172.16.0.1",
			"192.168.1.1",
			"::",
			"::1",
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"64:ff9b::7f00:1",
			"64:ff9b:1::a00:1",
			"2001::1",
			"2002:7f00:1::",
			"fc00::1",
			"fe80::1",
			"ff02::1",
			"not-an-ip",
		])
			assert.equal(isPublicProfileAddress(address), false, address);
		assert.equal(isPublicProfileAddress("8.8.8.8"), true);
		assert.equal(isPublicProfileAddress("2606:4700:4700::1111"), true);

		let requests = 0;
		const blockedSets = [
			[
				{ address: "8.8.8.8", family: 4 },
				{ address: "127.0.0.1", family: 4 },
			],
			[{ address: "::ffff:7f00:1", family: 6 }],
			[{ address: "8.8.8.8", family: 6 }],
		];
		for (let index = 0; index < blockedSets.length; index += 1) {
			const loader = new ProfileAssetLoader(undefined, {
				lookup: async () => blockedSets[index]!,
				request: async () => {
					requests += 1;
					return remoteResponse().response;
				},
			});
			assert.equal(await loader.loadBadge(`https://blocked-${index}.example/badge.png`), null);
		}
		const direct = new ProfileAssetLoader(undefined, {
			lookup: async () => {
				throw new Error("private literals must not resolve");
			},
			request: async () => {
				requests += 1;
				return remoteResponse().response;
			},
		});
		assert.equal(await direct.loadBadge("https://127.1/badge.png"), null);
		assert.equal(await direct.loadBadge("https://[::ffff:7f00:1]/badge.png"), null);
		assert.equal(requests, 0);
	});

	it("pins every request to validated DNS results and revalidates redirects", async () => {
		const first = remoteResponse(302, { location: "https://next.example/badge.png" }, []);
		const second = remoteResponse();
		const seen: Array<{ url: string; addresses: readonly string[] }> = [];
		const responses = [first.response, second.response];
		const loader = new ProfileAssetLoader(undefined, {
			lookup: async (hostname) => (hostname === "next.example" ? [{ address: "2606:4700:4700::1111", family: 6 }] : [{ address: "8.8.8.8", family: 4 }]),
			request: async (url, addresses) => {
				seen.push({ url: url.toString(), addresses: addresses.map(({ address }) => address) });
				return responses.shift()!;
			},
		});
		assert.deepEqual(await loader.loadBadge("https://start.example/badge.png"), TEST_PNG);
		assert.deepEqual(seen, [
			{ url: "https://start.example/badge.png", addresses: ["8.8.8.8"] },
			{ url: "https://next.example/badge.png", addresses: ["2606:4700:4700::1111"] },
		]);
		assert.deepEqual([first.state.dumped, first.state.destroyed, first.state.closed], [true, true, true]);
		assert.deepEqual([second.state.destroyed, second.state.closed], [true, true]);
	});

	it("blocks private and off-domain Discord redirects before a second request", async () => {
		for (const [initial, redirected] of [
			["https://assets.example/badge.png", "https://[::ffff:7f00:1]/secret.png"],
			["https://cdn.discordapp.com/embed/avatars/0.png", "https://example.com/avatar.png"],
		] as const) {
			const redirect = remoteResponse(302, { location: redirected }, []);
			let requests = 0;
			const loader = new ProfileAssetLoader(undefined, {
				lookup: async () => [{ address: "8.8.8.8", family: 4 }],
				request: async () => {
					requests += 1;
					return redirect.response;
				},
			});
			const result = initial.includes("discordapp.com") ? loader.loadDiscord(initial) : loader.loadBadge(initial);
			assert.equal(await result, null);
			assert.equal(requests, 1);
			assert.deepEqual([redirect.state.dumped, redirect.state.destroyed, redirect.state.closed], [true, true, true]);
		}
	});

	it("rejects bad status, content type, declared length, and image signatures with cleanup", async () => {
		const cases = [
			remoteResponse(404),
			remoteResponse(200, { "content-type": "text/html" }),
			remoteResponse(200, { "content-type": "image/png", "content-encoding": "gzip" }),
			remoteResponse(200, { "content-type": "image/gif" }),
			remoteResponse(200, { "content-type": "image/png", "content-length": "-1" }),
			remoteResponse(200, { "content-type": "image/png", "content-length": String(4 * 1024 * 1024 + 1) }),
			remoteResponse(200, { "content-type": ["image/png", "image/gif"] }),
			remoteResponse(200, { "content-type": "image/png" }, [Buffer.from("not an image")]),
		];
		for (let index = 0; index < cases.length; index += 1) {
			const current = cases[index]!;
			const loader = new ProfileAssetLoader(undefined, {
				lookup: async () => [{ address: "8.8.8.8", family: 4 }],
				request: async () => current.response,
			});
			assert.equal(await loader.loadBadge(`https://policy-${index}.example/badge.png`), null);
			assert.equal(current.state.destroyed, true);
			assert.equal(current.state.closed, true);
		}
	});

	it("stops buffering beyond the streaming limit and closes the response", async () => {
		const maximum = Buffer.alloc(4 * 1024 * 1024);
		TEST_PNG.copy(maximum);
		const oversized = remoteResponse(200, { "content-type": "image/png" }, [maximum, Buffer.from([1])]);
		const loader = new ProfileAssetLoader(undefined, {
			lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			request: async () => oversized.response,
		});
		assert.equal(await loader.loadBadge("https://large.example/badge.png"), null);
		assert.equal(oversized.state.yielded, 2);
		assert.deepEqual([oversized.state.destroyed, oversized.state.closed], [true, true]);
	});

	it("times out a transport that ignores abort without growing the cache indefinitely", async () => {
		let observedSignal: AbortSignal | null = null;
		const loader = new ProfileAssetLoader(undefined, {
			timeoutMs: 15,
			lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			request: async (_url, _addresses, signal) => {
				observedSignal = signal;
				return new Promise<ProfileAssetRemoteResponse>(() => undefined);
			},
		});
		assert.equal(await loader.loadBadge("https://stalled-transport.example/badge.png"), null);
		assert.equal(observedSignal?.aborted, true);
		assert.deepEqual(loader.cacheState(), { entries: 1, bytes: 0 });
	});

	it("aborts a stalled body, closes resources, and contains transport errors", async () => {
		const state: RemoteState = { dumped: false, destroyed: false, closed: false, yielded: 0 };
		let observedSignal: AbortSignal | null = null;
		const loader = new ProfileAssetLoader(undefined, {
			timeoutMs: 15,
			lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			request: async (_url, _addresses, signal) => {
				observedSignal = signal;
				return {
					statusCode: 200,
					headers: { "content-type": "image/png" },
					body: {
						async dump() {
							state.dumped = true;
						},
						destroy() {
							state.destroyed = true;
						},
						async *[Symbol.asyncIterator]() {
							await new Promise<void>((_resolve, reject) => {
								const fallback = setTimeout(() => reject(new Error("abort was not delivered")), 200);
								signal.addEventListener(
									"abort",
									() => {
										clearTimeout(fallback);
										reject(new Error("aborted"));
									},
									{ once: true },
								);
							});
						},
					},
					async close() {
						state.closed = true;
					},
				};
			},
		});
		assert.equal(await loader.loadBadge("https://slow.example/badge.png"), null);
		assert.equal(observedSignal?.aborted, true);
		assert.deepEqual([state.destroyed, state.closed], [true, true]);

		const failing = new ProfileAssetLoader(undefined, {
			lookup: async () => [{ address: "8.8.8.8", family: 4 }],
			request: async () => {
				throw new Error("transport failed");
			},
		});
		assert.equal(await failing.loadBadge("https://failure.example/badge.png"), null);
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
		assert.deepEqual(
			badges.map((badge) => badge.key),
			["staff", "bug-hunter-2", "active-developer"],
		);
		assert.equal(
			badges.some((badge) => /nitro/i.test(badge.key + badge.label)),
			false,
		);
	});

	it("keeps server booster explicit and bounds overflow", () => {
		const enabled = new Set(["Staff", "Partner", "Hypesquad", "BugHunterLevel1"]);
		const badges = mapOfficialProfileBadges({ has: (flag) => enabled.has(String(flag)) }, true);
		assert.equal(badges.at(-1)?.key, "server-booster");
		const layout = layoutOfficialBadges(badges, 100);
		assert.deepEqual(
			layout.visible.map((badge) => badge.key),
			["staff", "partner"],
		);
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

	it("fails closed on Redis errors and contains synchronous release failures", async () => {
		assert.equal(
			await acquireProfileAnimationLease(
				{
					set() {
						throw new Error("Redis unavailable");
					},
					eval() {
						throw new Error("unexpected eval");
					},
				} as any,
				"failed-acquire",
			),
			null,
		);

		let releases = 0;
		const release = await acquireProfileAnimationLease(
			{
				set: async () => "OK",
				eval() {
					releases += 1;
					throw new Error("synchronous release failure");
				},
			} as any,
			"release-error",
		);
		assert.ok(release);
		await assert.doesNotReject(release());
		await assert.doesNotReject(release());
		assert.equal(releases, 1);
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
